// 折淘客「高佣转链」接口（一步：淘口令/商品id/长链 -> 带PID推广短链）
// 密钥从环境变量读取：ZTK_APPKEY、ZTK_SID、ZTK_PID
// 路由：/api/zl  （GET ?tkl=内容  &pid=推广位  &sid=授权类型  &mode=raw 查看原始返回）
// 返回：{ ok, short, long, tkl, id, title, pic, raw }
//
// 折淘客只开非标准端口 10001/10000，Cloudflare fetch 不支持，用 cloudflare:sockets 直连。
//
// 关键修复（2026-11-14）：
//   高佣转链接口(open_gaoyongzhuanlian)只吃【淘口令】，不吃商品id/长链。
//   旧代码把整条 URL 当 tkl 丢进去 → 一律报"不支持数字id转链"。
//   现改为：从长链/数字自动抽 num_iid → 先 open_taokouling_create 造口令 → 再 open_gaoyongzhuanlian 转链；
//   同时保留「直接给淘口令」路径，并对 open_gaoyongzhuanlian_id(num_iid) 兜底。

import { connect } from 'cloudflare:sockets';

const HOSTS = [
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

async function ztkGet(host, port, pathQuery, ms) {
  const socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
  const timer = setTimeout(() => { try { socket.close(); } catch (_) {} }, ms || 9000);
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
      if (parts.reduce((n, p) => n + p.length, 0) > 512 * 1024) break;
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

// 从任意内容抽 num_iid（纯数字 / ?id= / itemId= / /i数字.htm / 长链 id=）
function extractNumIid(s) {
  s = String(s || '');
  let m = s.match(/[?&](?:num_iid|itemId|id)=(\d{6,})/i);
  if (m) return m[1];
  m = s.match(/item\.taobao\.com\/item\.htm[^'"]*?id=(\d{6,})/i);
  if (m) return m[1];
  m = s.match(/\/i(\d{6,})\.htm/i);
  if (m) return m[1];
  m = s.match(/^(\d{6,})$/);
  if (m) return m[1];
  return '';
}

// 判断是否为「淘口令」（￥码￥ 包裹，或纯口令文本且非链接）
function isTaokouling(s) {
  s = String(s || '').trim();
  if (/[￥¥][^￥¥\s]{4,}[￥¥]/.test(s)) return true;
  if (/^https?:\/\//i.test(s)) return false;
  if (/\d{6,}/.test(s)) return false; // 纯数字视为商品id
  return s.length >= 6; // 其余非链接文本当作口令
}

function pickTpwd(o) {
  if (!o || typeof o !== 'object') return '';
  return o.tbk_pwd || o.tpwd || o.password || (typeof o.model === 'object' && (o.model.tbk_pwd || o.model.tpwd)) || '';
}

function pickLink(o) {
  if (!o || typeof o !== 'object') return { short: '', long: '', tkl: '' };
  const short = o.shorturl || o.coupon_shorturl || o.tbk_short_url || '';
  const long = o.longurl || o.coupon_longurl || o.tbk_url || o.url || o.item_url || '';
  const tkl = o.tbk_pwd || o.tpwd || o.password || '';
  return { short, long, tkl };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  const u = new URL(request.url);
  const mode = u.searchParams.get('mode');
  let content = u.searchParams.get('tkl') || u.searchParams.get('content') || u.searchParams.get('url') || '';
  if (!content && request.method === 'POST') {
    try { const b = await request.json(); content = b.tkl || b.content || b.url || ''; } catch (_) { content = await request.text(); }
  }
  content = String(content || '').trim();
  if (!content) return json({ ok: false, error: 'missing tkl/content' }, 400);

  const appkey = env.ZTK_APPKEY;
  const sid = (u.searchParams.get('sid') || env.ZTK_SID || '').trim();
  const pid = (u.searchParams.get('pid') || env.ZTK_PID || '').trim();
  if (!appkey || !sid) return json({ ok: false, error: 'missing ZTK_APPKEY/ZTK_SID' }, 500);

  const pidQ = pid ? '&pid=' + encodeURIComponent(pid) : '';
  const c = encodeURIComponent(content);
  const numIid = extractNumIid(content) || u.searchParams.get('num_iid') || '';

  const results = {};
  let finalTkl = '';

  // —— 路径1：直接给了淘口令 → 直接高佣转链 ——
  if (isTaokouling(content)) {
    for (const { host, port } of HOSTS) {
      try {
        const r = await ztkGet(host, port,
          `/api/open_gaoyongzhuanlian.ashx?appkey=${appkey}&sid=${sid}${pidQ}&tkl=${c}`, 9000);
        results.zhuanlian = r;
        finalTkl = content;
        break;
      } catch (e) { results.err1 = String((e && e.message) || e); }
    }
  }

  // —— 路径2：给了商品id/长链 → 先造口令，再转链 ——
  let createdTpwd = '';
  if (numIid && !finalTkl) {
    for (const { host, port } of HOSTS) {
      try {
        const r = await ztkGet(host, port,
          `/api/open_taokouling_create.ashx?appkey=${appkey}&sid=${sid}${pidQ}&num_iid=${encodeURIComponent(numIid)}`, 9000);
        results.create = r;
        createdTpwd = pickTpwd(r);
        if (createdTpwd) {
          const ec = encodeURIComponent(createdTpwd);
          const r2 = await ztkGet(host, port,
            `/api/open_gaoyongzhuanlian.ashx?appkey=${appkey}&sid=${sid}${pidQ}&tkl=${ec}`, 9000);
          results.zhuanlian = r2;
          finalTkl = createdTpwd;
        }
        break;
      } catch (e) { results.err2 = String((e && e.message) || e); }
    }
  }

  // —— 路径3：兜底，直接用 num_iid 走 open_gaoyongzhuanlian_id ——
  if (numIid && !finalTkl) {
    for (const { host, port } of HOSTS) {
      try {
        const r = await ztkGet(host, port,
          `/api/open_gaoyongzhuanlian_id.ashx?appkey=${appkey}&sid=${sid}${pidQ}&num_iid=${encodeURIComponent(numIid)}`, 9000);
        results.zhuanlian_id = r;
        break;
      } catch (e) { results.err3 = String((e && e.message) || e); }
    }
  }

  // —— 短链（淘客短网址）按需补充 ——
  if (finalTkl) {
    for (const { host, port } of HOSTS) {
      try {
        const r = await ztkGet(host, port,
          `/api/open_shorturl_taobao_get.ashx?appkey=${appkey}&sid=${sid}&content=${encodeURIComponent(finalTkl)}`, 9000);
        results.shorturl = r;
        break;
      } catch (e) { results.err4 = String((e && e.message) || e); }
    }
  }

  const z = Object.assign({}, results.zhuanlian || {}, results.zhuanlian_id || {});
  const { short, long, tkl } = pickLink(z);
  const shortUrl = (results.shorturl && pickLink(results.shorturl).short) || short;

  if (mode === 'raw') {
    return json({ ok: !!long || !!tkl, short: shortUrl, long, tkl, id: numIid, raw: results });
  }
  return json({
    ok: !!shortUrl || !!long || !!tkl,
    short: shortUrl, long, tkl,
    id: numIid,
    title: z.title || (results.create && results.create.title) || '',
    pic: z.pic_url || z.pict_url || '',
    raw: results,
  });
}
