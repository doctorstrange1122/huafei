// GET /account/ws?token=xxx -> WebSocket 101（实时推送）
//
// 参考 task-record-tool：每个账号对应一个 SyncHub Durable Object 实例，持有该账号
// 所有在线设备的 WebSocket 长连接。PUT /account/data 成功后，data.js 通过
// env.SYNC_HUB 内部调用 /notify 广播 {type:'changed',at}，本端连接的设备秒级收到。
//
// 走 Cloudflare 内部绑定调用，不经过公网 workers.dev；客户端始终只访问
// wss://huafei-redirect-pages.pages.dev/account/ws。
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}

async function verifyToken(token, kv) {
  if (!token) return null;
  const rec = await kv.get('tok:' + token, { type: 'json' });
  if (!rec || rec.expiresAt < Date.now()) return null;
  return rec.username;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
  if (upgrade !== 'websocket') {
    return json({ error: '需要 WebSocket 升级请求' }, 426);
  }

  // token 通过 query 传递（WebSocket 无法自定义 Authorization 头）
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ||
    (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const kv = env.KEY_STORE;
  if (!kv) return json({ error: '服务未配置存储' }, 500);
  const username = await verifyToken(token, kv);
  if (!username) return json({ error: '未登录或登录已过期' }, 401);

  if (!env.SYNC_HUB) {
    // 绑定未配置：明确报错，前端据此自动降级为轮询，不影响主流程
    return json({ error: '实时服务未配置' }, 503);
  }

  try {
    // 按账号隔离实例，避免不同账号互相收到广播
    const id = env.SYNC_HUB.idFromName('huafei_u_' + username);
    return await env.SYNC_HUB.get(id).fetch(request);
  } catch (e) {
    return json({ error: '实时服务暂不可用' }, 503);
  }
}
