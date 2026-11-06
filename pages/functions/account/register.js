// POST /account/register  { username: 8-11位数字, password: >=6位, nickname: 必填 }
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
// Cloudflare 运行时自带 scrypt（N=1024, r=8, p=1, 输出 32 字节）
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
  const nickname = String(body.nickname || '').trim();
  if (!/^\d{8,11}$/.test(username)) return json({ error: '用户名须为 8-11 位数字' }, 400);
  if (password.length < 6) return json({ error: '密码至少 6 位' }, 400);
  if (nickname.length < 1 || nickname.length > 20) return json({ error: '昵称须为 1-20 个字符' }, 400);

  const kv = env.KEY_STORE;
  if (!kv) return json({ error: '服务未配置存储' }, 500);
  if (await kv.get('acct:' + username)) return json({ error: '账号已存在' }, 409);

  const salt = crypto.randomUUID();
  const pwHash = await scryptHash(password, salt);
  await kv.put('acct:' + username, JSON.stringify({ pwHash, salt, nickname, createdAt: Date.now() }));
  return json({ ok: true });
}
