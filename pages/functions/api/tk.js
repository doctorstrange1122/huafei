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

// —— 淘口令规范化 ——
// 实测：折淘客解析接口收到「含 http(s) 链接的长文本」会失败（Stream was cancelled），
// 必须先从商品分享文案中抠出纯口令码。这里按命中概率从高到低产出候选，依次重试。
const NOISE_WORDS = [
  '点击链接直接打开', '或者', '淘宝搜索直接打开', '拷贝链接', '复制链接', '复制本条信息',
  '复制这条信息', '打开淘宝', '打开👉淘宝', '到淘宝', '长按复制', '打开手机淘宝',
  '【', '】', '「', '」', '『', '』', '￥', '¥', '$',
];

function normalizeCandidates(input) {
  const s = String(input || '').replace(/&amp;/g, '&').trim();
  const out = [];
  const push = (v) => {
    v = String(v == null ? '' : v).trim();
    if (v && v.length <= 300 && !out.includes(v)) out.push(v);
  };

  // 1) 链接里的口令参数：?tk= / &tk= / code= / pwd= / tkl=
  for (const m of s.matchAll(/[?&](?:tk|code|pwd|tkl|tpwd|password|password_content)=([A-Za-z0-9_-]{6,})/g)) push(m[1]);

  // 2) 币符/括号包裹的口令正文
  for (const m of s.matchAll(/[￥¥]([^￥¥\s]{6,})[￥¥]/g)) push(m[1]);
  for (const m of s.matchAll(/[(（]([A-Za-z0-9]{8,})[)）]/g)) push(m[1]);

  // 3) 剥掉所有 URL 后的剩余文本
  const noUrl = s.replace(/https?:\/\/[^\s，,、)]+/gi, ' ').replace(/\s+/g, ' ').trim();
  push(noUrl);

  // 4) 去掉中文与话术后剩下的字母数字片段（如 "CZ5073 1g2ITzuYm9G"）
  let cleaned = noUrl;
  for (const w of NOISE_WORDS) cleaned = cleaned.split(w).join(' ');
  cleaned = cleaned.replace(/[\u4e00-\u9fa5]/g, ' ').replace(/\s+/g, ' ').trim();
  push(cleaned);
  for (const m of cleaned.matchAll(/[A-Za-z0-9_-]{8,}/g)) push(m[0]);

  // 5) 原文兜底
  push(s);
  return out.slice(0, 6);
}

// 已经是「带商品 id 的淘宝/天猫长链」时无需解析；短链(tb.cn/e.tb.cn)仍优先解析成直连长链
function directTaobaoUrl(s) {
  if (!/^https?:\/\//i.test(s)) return '';
  const u = s.trim();
  if (/[?&]id=\d{6,}/.test(u) && /(^|\.)(taobao|tmall)\./i.test(u)) return u;
  return '';
}

function pickItemId(u) {
  const m = String(u || '').match(/[?&]id=(\d{6,})/);
  return m ? m[1] : '';
}

// 解析结果常带 ut_sk/wxsign/sp_tk 等一大串追踪参数，二维码会非常密。
// 这里给出一份只保留商品 id 的精简链接，供生成二维码使用（打开更稳、码更稀疏）。
function cleanUrl(u) {
  const s = String(u || '');
  const id = pickItemId(s);
  if (!id) return '';
  const host = (s.match(/^https?:\/\/([^/]+)/i) || [])[1] || '';
  if (/^item\.taobao\.com$/i.test(host)) return 'https://item.taobao.com/item.htm?id=' + id;
  if (/^(detail|item)\.(tmall|tmall\.hk)\.com$/i.test(host)) return 'https://' + host + '/item.htm?id=' + id;
  return '';
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

  // 接口已明确返回（含错误码）时不换域名，直接判定该候选失败，交给下一个候选；
  // 只有 TCP/TLS 连接本身失败才换备用域名重连。
  const max = Number(env.ZTK_TIMEOUT_MS || 9000);
  for (const { host, port } of ZTK_HOSTS) {
    let r = null;
    try {
      // 1) 解析淘口令 -> 返回推广 url（商品/活动类口令均支持）
      r = await ztkGet(host, port, `/api/open_taokouling_jiexi.ashx?appkey=${appkey}&sid=${sid}&content=${c}${jb}${pid}`, max);
    } catch (e) {
      lastErr = String((e && e.message) || e);
      continue; // 连接问题 -> 换域名重试
    }
    if (r && r.url) return { url: r.url, title: r.content || r.title || '', raw: r };

    try {
      // 2) 退：解析商品编号 -> 返回 itemId（淘客商品口令）
      const r2 = await ztkGet(host, port, `/api/open_shangpin_id.ashx?appkey=${appkey}&sid=${sid}&content=${c}&type=1${jb}${pid}`, max);
      const id = r2 && (r2.item_id || r2.num_iid);
      if (id) return { id: String(id), url: 'https://item.taobao.com/item.htm?id=' + id, title: r2.title || '', raw: r2 };
    } catch (_) { /* ignore */ }

    return { err: 'zhetaoke: ' + ((r && r.content) || 'no url'), raw: r };
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

  // 0) 输入本身就是淘宝/天猫短链或商品链接 —— 直接可用，无需解析
  const direct = directTaobaoUrl(tkl);
  if (direct) {
    return json({ ok: true, url: direct, clean: cleanUrl(direct), id: pickItemId(direct), title: '', pic: '', via: 'direct' });
  }

  // 折淘客优先（免费），未配置则退 taokouling；按规范化候选依次重试
  const cands = normalizeCandidates(tkl);
  let out = { err: 'no provider configured' };
  for (const c of cands) {
    if (env.ZTK_APPKEY && env.ZTK_SID) out = await viaZhetaoke(c, env);
    else if (env.TK_APIKEY) out = await viaTaokouling(c, env);
    if (!out.err) {
      return json({
        ok: true, url: out.url || '', clean: cleanUrl(out.url),
        id: out.id || pickItemId(out.url),
        title: out.title || '', pic: out.pic || '', via: 'api', matched: c,
      });
    }
  }
  return json({ ok: false, error: out.err, tried: cands, raw: out.raw || null });
}
