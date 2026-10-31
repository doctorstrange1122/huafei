// 淘口令解析接口（第三方：折淘客 / taokouling）
// 密钥一律从环境变量读取（Cloudflare Pages 后台配置），切勿写入代码或提交仓库：
//   折淘客：ZTK_APPKEY、ZTK_SID（导购类型授权ID实测可用）、ZTK_PID（可选）、ZTK_JB（'1'=开启收费解析）
//   taokouling：TK_APIKEY
// 路由：/api/tk  （GET ?tkl=口令  或  POST {tkl:"口令"}）
// 返回：{ ok, url, id, title } —— url 可直接生成二维码，id 为商品ID
//
// 注意：折淘客接口只开放在非标准端口 10001/10000，Cloudflare Workers 的 fetch 不支持，
// 因此这里用 cloudflare:sockets 的 TCP+TLS 直连，手写 HTTP/1.1 GET（响应为 Content-Length 定长 JSON，无 chunked）。

import { connect } from 'cloudflare:sockets';

const ZTK_HOSTS = [
  { host: 'api.zhetaoke.com', port: 10001 },
  { host: 'api.zhetaoke.cn', port: 10000 },
];

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  });
}

function extractTkl(input) {
  if (input == null) return '';
  let s = input;
  try {
    const j = JSON.parse(input);
    s = j.tkl || j.tpwd || j.text || j.content || j.password_content || input;
  } catch (_) { /* 非 JSON，原样使用 */ }
  return String(s).trim();
}

// —— 折淘客：TCP+TLS 直连非标准端口 ——
async function ztkGet(host, port, pathQuery, ms) {
  const socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
  const timer = setTimeout(() => { try { socket.close(); } catch (_) {} }, ms || 12000);
  try {
    const w = socket.writable.getWriter();
    await w.write(new TextEncoder().encode(
      `GET ${pathQuery} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n`
    ));
    w.releaseLock();
    const reader = socket.readable.getReader();
    const parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      if (parts.reduce((n, p) => n + p.length, 0) > 512 * 1024) break; // 防御性上限
    }
    reader.releaseLock();
    const raw = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) { raw.set(p, off); off += p.length; }
    const text = new TextDecoder().decode(raw);
    const idx = text.indexOf('\r\n\r\n');
    if (idx < 0) throw new Error('bad http response');
    return JSON.parse(text.slice(idx + 4).trim());
  } finally {
    clearTimeout(timer);
    try { socket.close(); } catch (_) {}
  }
}

async function viaZhetaoke(tkl, env) {
  const appkey = env.ZTK_APPKEY, sid = env.ZTK_SID;
  if (!appkey || !sid) return { err: 'missing ZTK_APPKEY/ZTK_SID' };
  const jb = env.ZTK_JB === '1' ? '&jb=1' : '';
  const pid = env.ZTK_PID ? '&pid=' + encodeURIComponent(env.ZTK_PID) : '';
  const c = encodeURIComponent(tkl);
  let lastErr = '';

  for (const { host, port } of ZTK_HOSTS) {
    try {
      // 1) 解析淘口令 -> 返回推广 url（生成二维码最需要；商品/活动类口令均支持）
      let r = await ztkGet(host, port, `/api/open_taokouling_jiexi.ashx?appkey=${appkey}&sid=${sid}&content=${c}${jb}${pid}`);
      if (r && r.url) return { url: r.url, title: r.content || r.title || '', raw: r };
      lastErr = (r && r.content) || 'no url';

      // 2) 退：解析商品编号 -> 返回 itemId（淘客商品口令）
      r = await ztkGet(host, port, `/api/open_shangpin_id.ashx?appkey=${appkey}&sid=${sid}&content=${c}&type=1${jb}${pid}`);
      const id = r && (r.item_id || r.num_iid);
      if (id) return { id: String(id), url: 'https://item.taobao.com/item.htm?id=' + id, title: r.title || '', raw: r };
    } catch (e) {
      lastErr = String(e && e.message || e);
    }
  }
  return { err: 'zhetaoke parse failed: ' + lastErr };
}

async function viaTaokouling(tkl, env) {
  const apikey = env.TK_APIKEY;
  if (!apikey) return { err: 'missing TK_APIKEY' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await (await fetch(`https://api.taokouling.com/tkl/viptkljm?apikey=${apikey}&tkl=${encodeURIComponent(tkl)}`,
      { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
    if (r && r.url) return { url: r.url, title: r.content || '', pic: r.picUrl || '', raw: r };
    return { err: (r && (r.msg || r.ret)) || 'taokouling parse failed', raw: r };
  } finally { clearTimeout(timer); }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' },
    });
  }

  let raw = '';
  try {
    if (request.method === 'POST') {
      const ct = request.headers.get('content-type') || '';
      raw = ct.includes('application/json') ? JSON.stringify(await request.json()) : await request.text();
    } else {
      const u = new URL(request.url);
      raw = u.searchParams.get('tkl') || u.searchParams.get('tpwd') ||
            u.searchParams.get('text') || u.searchParams.get('content') || '';
    }
  } catch (_) { /* ignore */ }

  const tkl = extractTkl(raw);
  if (!tkl) return json({ ok: false, error: 'missing tkl' }, 400);

  // 折淘客优先（免费），未配置则退 taokouling
  let out = { err: 'no provider configured' };
  if (env.ZTK_APPKEY && env.ZTK_SID) out = await viaZhetaoke(tkl, env);
  else if (env.TK_APIKEY) out = await viaTaokouling(tkl, env);

  if (out.err) return json({ ok: false, error: out.err, raw: out.raw || null });
  return json({ ok: true, url: out.url || '', id: out.id || '', title: out.title || '', pic: out.pic || '' });
}
