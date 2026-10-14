// Cloudflare Pages Function: 服务端商品 id 解析（方案A 主路径）
// 用法: https://huafei-redirect-pages.pages.dev/api/resolve?url=<分享文本或链接>
//
// 设计目标：把"展开淘宝短链 + 抽取商品 id"的重活放到服务端，避免 4.2 等低端设备
// 在浏览器里自己追 e.tb.cn 重定向链而失败/超时（这也是此前 4.2 解析慢的根因）。
// 前端把分享文案整体发给本接口，服务端：
//   0) 纯数字 id 直接返回（零网络，毫秒）
//   1) 对文案里所有 URL 试直读（长链 / itemIds= 等秒回，不联网）
//   2) 短链 → 同时尝试 e.tb.cn 与等价 m.tb.cn 变体，多 UA 并行抓取 + 重定向跟随 + 正则抽 id
//   3) 首轮失败（上游抖动）后短暂重试一次；body 含 item/tmall 链接则二次跟随
// 兼容 CORS（前端跨域简单 GET 调用，无需预检）。

const UA_POOL = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 9; HUAWEI VOG-AL10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// 从任意文本中抽取商品 id（多 id 去重，支持 itemIds=/shareDetailItemId=/id=/topIds=/i数字.htm/数字.html/var url=/JSON itemId/item.taobao.com/detail.tmall.com）
// shareDetailItemId=：淘宝分享落地页（pages-fast.m.taobao.com 的 var url）2026-10 起使用的新格式，
// 与老格式 itemIds= 并存；只认老格式会漏抽（真实案例：e.tb.cn/h.jYO0YKTrj0CVDUj 的 id 949977297895）。
function extractIds(text) {
  if (!text) return [];
  const ids = new Set();
  const push = (s) => {
    if (!s) return;
    let m;
    const reItem = /[?&]itemIds=([^&\s'"<>]+)/g;
    while ((m = reItem.exec(s))) m[1].split(',').forEach(x => { const t = x.trim(); if (/^\d{7,}$/.test(t)) ids.add(t); });
    const reShare = /[?&]shareDetailItemId=(\d{7,})/g; while ((m = reShare.exec(s))) ids.add(m[1]);
    const reId = /[?&]id=(\d{7,})/g;        while ((m = reId.exec(s))) ids.add(m[1]);
    const reTop = /topIds=(\d+)/g;           while ((m = reTop.exec(s))) ids.add(m[1]);
    const reI = /\/i(\d+)\.htm/g;            while ((m = reI.exec(s))) ids.add(m[1]);
    const reHtml = /\/(\d{7,})\.html?/g;     while ((m = reHtml.exec(s))) ids.add(m[1]);
    const reVar = /var\s+url\s*=\s*['"]([^'"]+)['"]/g; while ((m = reVar.exec(s))) push(m[1]);
    const reJson = /"itemId"\s*:\s*"?(\d{7,})/g; while ((m = reJson.exec(s))) ids.add(m[1]);
    const reLink = /item\.taobao\.com\/item\.htm[^'"]*?id=(\d{7,})/gi; while ((m = reLink.exec(s))) ids.add(m[1]);
    const reTmall = /detail\.tmall\.com\/item\.htm[^'"]*?id=(\d{7,})/gi; while ((m = reTmall.exec(s))) ids.add(m[1]);
    const reUland = /uland\.taobao\.com\/[^'"]*?id=(\d{7,})/gi; while ((m = reUland.exec(s))) ids.add(m[1]);
  };
  push(text);
  return [...ids];
}

// 从分享文本中提取所有 URL
function findUrls(text) {
  return (text.match(/https?:\/\/[^\s，。￥¥₳【】\]\['"<>]+/g) || []);
}

// 由 e.tb.cn / m.tb.cn 短链生成等价变体，提升跟随成功率
function buildVariants(target) {
  const variants = [target];
  const me = target.match(/https?:\/\/e\.tb\.cn\/h\.([A-Za-z0-9]+)/i);
  if (me) variants.push('https://m.tb.cn/h.' + me[1]);
  const mm = target.match(/https?:\/\/m\.tb\.cn\/h\.([A-Za-z0-9]+)/i);
  if (mm) variants.push('https://e.tb.cn/h.' + mm[1]);
  return variants;
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
    return { finalUrl, status: resp.status, body, ids: extractIds(finalUrl + '\n' + body) };
  } catch (e) {
    clearTimeout(timer);
    return { error: e.message };
  }
}

// 服务端展开短链并抽 id（多 UA 并行，单 UA 4s 超时；变体 + 二次跟随兜底）
async function resolveShortLink(target) {
  const referer = 'https://tb.cn/';
  const variants = buildVariants(target);
  let best = { url: '', status: 0, body: '', ids: [] };
  for (const v of variants) {
    const settled = await Promise.allSettled(UA_POOL.map(ua => tryFetch(v, ua, referer, 4000)));
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      const r = s.value;
      if (r.error) continue;
      if (r.ids.length) return { url: r.finalUrl, status: r.status, body: r.body, ids: r.ids };
      if (r.finalUrl !== v || r.body.length > best.body.length) {
        best = { url: r.finalUrl, status: r.status, body: r.body, ids: best.ids };
      }
    }
  }
  // 二次跟随：body 含 item.taobao.com / detail.tmall.com 链接 → 追一层拿真实商品页再抽
  if (best.body) {
    const mm = best.body.match(/item\.taobao\.com\/item\.htm[^'"]*/i)
            || best.body.match(/detail\.tmall\.com\/item\.htm[^'"]*/i);
    if (mm) {
      const next = mm[0].startsWith('http') ? mm[0] : 'https://' + mm[0];
      const r2 = await tryFetch(next, UA_POOL[0], referer, 4000);
      if (!r2.error && r2.ids.length) return { url: r2.finalUrl, status: r2.status, body: r2.body, ids: r2.ids };
    }
  }
  return best;
}

async function resolve(input) {
  // 0. 纯数字 id 直接返回（零网络，毫秒）
  //    仅当输入“整体就是一个/多个 id”时才走此路径：允许 id=/itemIds=/topIds= 前缀，
  //    逗号/分号/顿号/空白/各类括号分隔，以及 ¥￥₳₴ 等货币符号。
  //    含字母、链接或汉字的分享文案（如“【淘宝】xxx https://e.tb.cn/h.jY24.. HU926 拷贝链接”）
  //    绝不能走此路径——否则把非数字全部删掉后会拼出伪 id：
  //    真实案例：短链路径数字 24/3/9 + 淘口令 926 拼成 7 位 2439926，覆盖了正确 id 1088746595790。
  const raw = (input || '').trim();
  const stripped = raw.replace(/\b(?:id|itemIds|topIds)\s*=\s*/gi, ' ');
  if (/^[\d\s,，;；、·()（）\[\]{}【】¥￥₳₴]+$/.test(stripped)) {
    const ids = [];
    const seen = new Set();
    for (const part of stripped.split(/[\s,，;；、·]+/)) {
      const p = part.replace(/[()（）\[\]{}【】¥￥₳₴]/g, '').trim();
      if (/^\d{7,}$/.test(p) && !seen.has(p)) { seen.add(p); ids.push(p); }
    }
    if (ids.length) return { ids, url: '', status: 0, body: '' };
  }
  // 1. 先对分享文本里所有 URL 试直读（长链 / 纯 id 秒回，不联网）
  const urls = findUrls(input);
  for (const u of urls) {
    const direct = extractIds(u);
    if (direct.length) return { ids: direct, url: u, status: 0, body: '' };
  }
  // 2. 短链 → 服务端展开抽 id（最多两轮：首轮失败的上游抖动后短暂重试一次）
  const candidates = urls.length ? urls : [input];
  let last = { ids: [], url: '', status: 0, body: '' };
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const c of candidates) {
      const r = await resolveShortLink(c);
      if (r.ids && r.ids.length) return { ids: r.ids, url: r.url, status: r.status, body: r.body };
      if (r.url || r.body) last = r;
    }
    if (attempt === 0) await new Promise(res => setTimeout(res, 400));
  }
  return last;
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const target = url.searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing url parameter' }), { status: 400, headers: CORS });
  }

  // tk 诊断字段：分享文案整体不是合法 URL，new URL 会失败，改用正则从文本中提取
  let tk = '';
  const tkM = target.match(/[?&]tk=([A-Za-z0-9]+)/);
  if (tkM) tk = tkM[1];
  else { try { tk = new URL(target).searchParams.get('tk') || ''; } catch (e) {} }

  // 总超时 9s：e.tb.cn 偶发卡死时，到点即返回失败，不让前端无限等待
  const winner = await Promise.race([
    resolve(target).then(r => ({ ...r, timedout: false })),
    new Promise(res => setTimeout(() => res({ ids: [], url: '', status: 0, body: '', timedout: true }), 9000))
  ]);

  if (!winner.ids || winner.ids.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: winner.timedout ? 'timeout' : 'not found', tk }), { status: 200, headers: CORS });
  }

  return new Response(JSON.stringify({ ok: true, ids: winner.ids, url: winner.url, tk }), { headers: CORS });
}
