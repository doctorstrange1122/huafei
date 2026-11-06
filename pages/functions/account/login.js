// POST /account/login  { username, password } -> { token, expiresAt, nickname, username }
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}
function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function scryptHash(password, salt) {
  // Workers/Pages 运行时没有 Node 的 crypto.scrypt，改用 Web Crypto PBKDF2（SHA-256, 10万次）
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    material, 256
  );
  return bufToBase64(bits);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ error: '方法不允许' }, 405);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '请求格式错误' }, 400); }
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  const kv = env.KEY_STORE;
  if (!kv) return json({ error: '服务未配置存储' }, 500);
  const rec = await kv.get('acct:' + username, { type: 'json' });
  if (!rec) return json({ error: '账号或密码错误' }, 401);

  const pwHash = await scryptHash(password, rec.salt);
  if (pwHash !== rec.pwHash) return json({ error: '账号或密码错误' }, 401);

  const nickname = rec.nickname || username;
  const token =
    crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = Date.now() + 30 * 86400 * 1000;
  await kv.put('tok:' + token, JSON.stringify({ username, nickname, expiresAt }));
  return json({ token, expiresAt, nickname, username });
}
