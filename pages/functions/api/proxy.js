// Cloudflare Pages Function: 淘宝短链/分享文本解析代理
// 用法: https://tktool.pages.dev/api/proxy?url=<target_url>
//
// 优化点（针对 e.tb.cn / m.tb.cn 短链 + tk 淘口令在低端设备经常解析失败）：
//  1. UA 池并行请求（Promise.allSettled），谁先返回有效结果用谁，避免串行轮询浪费时间
//  2. 单 UA 请求 4s 超时；整体 10s 总超时保护：到点即返回当前最优结果，不再无限等待 e.tb.cn 卡死
//  3. 重定向跟随（redirect:'follow'）取 finalUrl；服务端直接抽取商品 id，覆盖：
//     - itemIds= / id= / topIds= / /i数字.htm / 数字.html
//     - 淘宝 H5 落地页常见的 var url='https://item.taobao.com/item.htm?id=...'
//     - 响应体 JSON 里的 "itemId"
//     - 响应体中任意 item.taobao.com/item.htm?id= 链接
//  4. 二次跟随：首轮没抽到 id 但 body 含 item.taobao.com/item.htm 链接 → 追一层拿真实商品页再抽
//  5. 附 Referer 提升短链跟随成功率；返回 tk 便于排查

const UA_POOL = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 9; HUAWEI VOG-AL10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
];

// 从任意文本中抽取商品 id（支持多 id 逗号拼接、自动去重）
function extractIds(text) {
  if (!text) return [];
  const ids = new Set();
  const push = (s) => {
    if (!s) return;
    let m;
    const reItem = /[?&]itemIds=([^&\s'"<>]+)/g;
    while ((m = reItem.exec(s))) m[1].split(',').forEach(x => { const t = x.trim(); if (/^\d{7,}$/.test(t)) ids.add(t); });
    const reId = /[?&]id=(\d{7,})/g;        while ((m = reId.exec(s))) ids.add(m[1]);
    const reTop = /topIds=(\d+)/g;           while ((m = reTop.exec(s))) ids.add(m[1]);
    const reI = /\/i(\d+)\.htm/g;            while ((m = reI.exec(s))) ids.add(m[1]);
    const reHtml = /\/(\d{7,})\.html?/g;     while ((m = reHtml.exec(s))) ids.add(m[1]);
    const reVar = /var\s+url\s*=\s*['"]([^'"]+)['"]/g; while ((m = reVar.exec(s))) push(m[1]);
    const reJson = /"itemId"\s*:\s*"?(\d{7,})/g; while ((m = reJson.exec(s))) ids.add(m[1]);
    const reLink = /item\.taobao\.com\/item\.htm[^'"]*?id=(\d{7,})/gi; while ((m = reLink.exec(s))) ids.add(m[1]);
  };
  push(text);
  return [...ids];
}

async function tryFetch(u, ua, referer, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(u, {
      headers: { 'User-Agent': ua, 'Accept': '*/*', 'Referer': referer },
      redirect: 'follow',
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const finalUrl = resp.url || u;
    const body = await resp.text();
    return { finalUrl, status: resp.status, body };
  } catch (e) {
    clearTimeout(timer);
    return { error: e.message };
  }
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

async function resolve(target) {
  const referer = 'https://tb.cn/';
  // 并行尝试所有 UA，谁先返回有效结果用谁（单 UA 4s 超时）
  const settled = await Promise.allSettled(UA_POOL.map(ua => tryFetch(target, ua, referer, 4000)));
  let best = { url: '', status: 0, body: '', ids: [] };
  let lastErr = '';
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const r = s.value;
    if (r.error) { lastErr = r.error; continue; }
    const ids = extractIds(r.finalUrl + '\n' + r.body);
    if (ids.length) { best = { url: r.finalUrl, status: r.status, body: r.body, ids }; break; }
    // 记录响应最完整的一次（最终地址有变化，或 body 更长）
    if (r.finalUrl !== target || r.body.length > best.body.length) {
      best = { url: r.finalUrl, status: r.status, body: r.body, ids: best.ids.length ? best.ids : ids };
    }
  }

  // 二次跟随：首轮没抽到 id，但 body 里含 item.taobao.com/item.htm 链接 → 追到真实商品页再抽
  if (best.ids.length === 0 && best.body) {
    const mm = best.body.match(/item\.taobao\.com\/item\.htm[^'"]*/i);
    if (mm) {
      const next = mm[0].startsWith('http') ? mm[0] : 'https://' + mm[0];
      const r2 = await tryFetch(next, UA_POOL[0], referer, 4000);
      if (!r2.error) {
        const ids2 = extractIds(r2.finalUrl + '\n' + r2.body);
        if (ids2.length) best = { url: r2.finalUrl, status: r2.status, body: r2.body, ids: ids2 };
      }
    }
  }
  return { best, lastErr };
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), { status: 400, headers: CORS });
  }

  let tk = '';
  try { tk = new URL(target).searchParams.get('tk') || ''; } catch (e) {}

  // 总超时 10s：e.tb.cn 偶发卡死时，到点即返回当前 best，不让前端无限等待
  const winner = await Promise.race([
    resolve(target),
    new Promise(res => setTimeout(() => res({ best: { url: '', status: 0, body: '', ids: [] }, lastErr: 'total timeout' }), 10000))
  ]);
  const { best, lastErr } = winner;

  if (best.status === 0 && best.body === '') {
    return new Response(JSON.stringify({ error: lastErr || 'all UA requests failed', tk }), { status: 502, headers: CORS });
  }

  return new Response(JSON.stringify({
    url: best.url,
    status: best.status,
    body: best.body,
    ids: best.ids,
    tk
  }), { headers: CORS });
}
