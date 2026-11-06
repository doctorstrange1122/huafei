// GET  /account/data  -> { commonIds, selfButtons }   (需 Authorization: Bearer <token>)
// PUT  /account/data  -> { ok:true }                   (body: { commonIds, selfButtons })
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}
async function verifyToken(request, kv) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  const rec = await kv.get('tok:' + token, { type: 'json' });
  if (!rec || rec.expiresAt < Date.now()) return null;
  return rec.username;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const kv = env.KEY_STORE;
  if (!kv) return json({ error: '服务未配置存储' }, 500);

  if (request.method === 'GET') {
    const username = await verifyToken(request, kv);
    if (!username) return json({ error: '未登录或登录已过期' }, 401);
    const data = (await kv.get('data:' + username, { type: 'json' })) || {};
    return json({
      commonIds: Array.isArray(data.commonIds) ? data.commonIds : [],
      selfButtons: Array.isArray(data.selfButtons) ? data.selfButtons : [],
      updatedAt: Number(data.updatedAt) || 0,
    });
  }

  if (request.method === 'PUT') {
    const username = await verifyToken(request, kv);
    if (!username) return json({ error: '未登录或登录已过期' }, 401);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: '请求格式错误' }, 400); }
    const commonIds = Array.isArray(body.commonIds) ? body.commonIds : [];
    const selfButtons = Array.isArray(body.selfButtons) ? body.selfButtons : [];
    const now = Date.now();
    await kv.put('data:' + username, JSON.stringify({ commonIds, selfButtons, updatedAt: now }));
    // 写入成功 → 广播给该账号的其它在线设备（Cloudflare 内部绑定调用，不经过公网）
    // 失败静默降级：前端仍有轮询兜底，不影响上传主流程
    await notifyChange(env, username, now);
    return json({ ok: true, updatedAt: now });
  }

  return json({ error: '方法不允许' }, 405);
}

/**
 * 通过 Durable Object 绑定向该账号的 SyncHub 广播「数据已更新」。
 * 与 task-record-tool 的 notifyChange 一致：/notify 会把 {type:'changed',at}
 * 发给该实例持有的全部 WebSocket 连接。
 */
async function notifyChange(env, username, at) {
  try {
    if (!env.SYNC_HUB) return;
    const id = env.SYNC_HUB.idFromName('huafei_u_' + username);
    await env.SYNC_HUB.get(id).fetch(
      'https://do/notify?at=' + encodeURIComponent(String(at)),
      { method: 'POST' }
    );
  } catch (e) {
    /* 实时推送不可用时静默降级为轮询 */
  }
}
