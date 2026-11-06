// GET /account/meta -> { updatedAt }
// 轻量版本探测：前端高频轮询只取版本戳（几十字节），发现云端比本地新才拉全量数据。
// 参考 task-record-tool 的 /api/meta 思路，把「秒级感知」的成本从整份数据降到一次 KV 小读。
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
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
  if (request.method !== 'GET') return json({ error: '方法不允许' }, 405);
  const kv = env.KEY_STORE;
  if (!kv) return json({ error: '服务未配置存储' }, 500);
  const username = await verifyToken(request, kv);
  if (!username) return json({ error: '未登录或登录已过期' }, 401);
  const data = (await kv.get('data:' + username, { type: 'json' })) || {};
  return json({ updatedAt: Number(data.updatedAt) || 0 });
}
