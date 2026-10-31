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
//
// 2026-10-31 新增【淘口令解析路径】：
//   文案里能抠出口令码（?tk= 参数 / ￥码￥ / CZ 格式 / 纯口令文本）时，
//   走折淘客解析（实测约 2.4s）与"追短链重定向"【并行竞速】，谁先拿到商品 id 用谁。
//   收益：① 商品分享文案不再被 e.tb.cn 偶发卡死拖到 9s 超时；② 纯淘口令（无链接）首次可解析。
//   注意：折淘客收到【含 http 的长文本】必失败，必须先剥出纯口令码（见 tklCandidates）。

import { connect } from 'cloudflare:sockets';

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

// 从任意文本中抽取商品 id（多 id 去重，支持 itemIds=/itemId=/shareDetailItemId=/id=/topIds=/i数字.htm/数字.html/var url=/JSON itemId/item.taobao.com/detail.tmall.com/uland.taobao.com）
// shareDetailItemId=：淘宝分享落地页（pages-fast.m.taobao.com 的 var url）2026-10 起使用的新格式，
// 与老格式 itemIds= 并存；只认老格式会漏抽（真实案例：e.tb.cn/h.jYO0YKTrj0CVDUj 的 id 949977297895）。
// itemId=（单数，query 形式）：2026-10-17 发现的又一变体——m.tb.cn/h.jcrMiTk 的落地页 var url 为
// pages-fast.m.taobao.com/.../tbms-limited-grad/detail?...&itemId=894516091577&...&skuId=5924516584641...
// 注意：只写 [^&\s] 的 id= 正则匹配不到它（id= 前是字母 m），必须显式认 [ ?&]itemId=；
// 同时切勿抽 skuId=（SKU id，非商品 id）。真实案例文本：
//   49💲TpWTTGSj1mY《 https://m.tb.cn/h.jcrMiTk  MF937 吃喝玩乐一站购齐
function extractIds(text) {
  if (!text) return [];
  const ids = new Set();
  const push = (s) => {
    if (!s) return;
    let m;
    const reItem = /[?&]itemIds=([^&\s'"<>]+)/g;
    while ((m = reItem.exec(s))) m[1].split(',').forEach(x => { const t = x.trim(); if (/^\d{7,}$/.test(t)) ids.add(t); });
    const reItemId = /[?&]itemId=(\d{7,})/g; while ((m = reItemId.exec(s))) ids.add(m[1]);
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
// 排除集含常见中文包裹符（《》「」『』【】）：分享文案常写成
// "49💲xxx《 https://m.tb.cn/h.xxxx  MF937 文案" 或 "【淘宝】链接「文案」"，不排除会把引号吸进 URL
function findUrls(text) {
  return (text.match(/https?:\/\/[^\s，。￥¥₳【】「」『』《》\]\['"<>]+/g) || []);
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

/* ============ 淘口令解析路径（折淘客，非标端口需 TCP+TLS 直连） ============ */
const ZTK_HOSTS = [
  { host: 'api.zhetaoke.com', port: 10001 },
  { host: 'api.zhetaoke.cn', port: 10000 },
];

async function ztkGet(host, port, pathQuery, ms) {
  const socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
  const timer = setTimeout(() => { try { socket.close(); } catch (_) {} }, ms || 6000);
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

// 判断这份输入值不值得跑折淘客（避免纯链接白跑一次）
function shouldTryTkl(s) {
  const t = String(s || '').trim();
  if (/[?&]tk=[A-Za-z0-9_-]{6,}/.test(t)) return true;      // 分享短链上的口令参数
  if (/[￥¥][^￥¥\s]{6,}[￥¥]/.test(t)) return true;          // ￥口令码￥
  if (/\bCZ[0-9A-Za-z]{2,}\s*[0-9A-Za-z]{6,}\s*\//.test(t)) return true; // CZ3457 xxx/
  if (/[₤₳₴]\s*[0-9A-Za-z]{8,}\s*[₤₳₴]/.test(t)) return true;
  return !/^https?:\/\//i.test(t);                           // 非链接开头：纯口令文案
}

// 剥出候选口令码（按命中概率排序；折淘客见 http 长文本必失败）
function tklCandidates(text) {
  const s = String(text || '').replace(/&amp;/g, '&').trim();
  const out = [];
  const push = (v) => { v = String(v == null ? '' : v).trim(); if (v && v.length <= 300 && !out.includes(v)) out.push(v); };
  for (const m of s.matchAll(/[?&](?:tk|code|pwd|tkl|tpwd|password)=([A-Za-z0-9_-]{6,})/g)) push(m[1]);
  for (const m of s.matchAll(/[￥¥]([^￥¥\s]{6,})[￥¥]/g)) push(m[1]);
  const noUrl = s.replace(/https?:\/\/[^\s，,、)]+/gi, ' ').replace(/\s+/g, ' ').trim();
  push(noUrl);
  let c = noUrl;
  for (const w of ['点击链接直接打开', '或者', '淘宝搜索直接打开', '拷贝链接', '复制这条信息', '复制本条信息', '打开淘宝', '【', '】', '「', '」', '￥', '¥']) c = c.split(w).join(' ');
  c = c.replace(/[\u4e00-\u9fa5]/g, ' ').replace(/\s+/g, ' ').trim();
  push(c);
  for (const m of c.matchAll(/[A-Za-z0-9_-]{8,}/g)) push(m[0]);
  return out.slice(0, 3);
}

// 折淘客解析：成功且能抽出商品 id 才作数（活动类口令没有商品 id，交给短链路径）
async function resolveByTkl(tkl, env) {
  const appkey = env.ZTK_APPKEY, sid = env.ZTK_SID;
  if (!appkey || !sid) return null;
  const pid = env.ZTK_PID ? '&pid=' + encodeURIComponent(env.ZTK_PID) : '';
  for (const { host, port } of ZTK_HOSTS) {
    try {
      const r = await ztkGet(host, port,
        `/api/open_taokouling_jiexi.ashx?appkey=${appkey}&sid=${sid}&content=${encodeURIComponent(tkl)}${pid}`, 6000);
      if (r && r.url) {
        const ids = extractIds(r.url);
        if (ids.length) return { ids, url: r.url, via: 'ztk', tkl };
      }
      break; // 接口已明确返回，不再换域名折腾
    } catch (_) { /* 连接问题 → 换备用域名 */ }
  }
  return null;
}

// 多路并行竞速：谁先拿到 id 用谁（而非等最慢的一路）
function raceIds(tasks) {
  return new Promise((resolve) => {
    let pending = tasks.length, settled = false;
    const finish = (r) => { if (!settled && r && r.ids && r.ids.length) { settled = true; resolve(r); } };
    for (const fn of tasks) {
      fn().then((r) => {
        finish(r);
        if (--pending === 0 && !settled) resolve(null);
      }).catch(() => { if (--pending === 0 && !settled) resolve(null); });
    }
  });
}

async function resolve(input, env) {
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
  // 2. 抽 id：淘口令解析 与 短链跟随【并行竞速】，谁先命中用谁
  const shortTask = async () => {
    const candidates = urls.length ? urls : [input];
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const c of candidates) {
        const r = await resolveShortLink(c);
        if (r.ids && r.ids.length) return { ids: r.ids, url: r.url, status: r.status, body: r.body, via: 'follow' };
      }
      if (attempt === 0) await new Promise(res => setTimeout(res, 400)); // 上游抖动后短暂重试
    }
    return null;
  };

  const cands = shouldTryTkl(input) ? tklCandidates(input) : [];
  if (cands.length) {
    const tklTask = async () => {
      for (const c of cands) {
        const r = await resolveByTkl(c, env);
        if (r) return r;
      }
      return null;
    };
    const win = await raceIds([tklTask, shortTask]);
    if (win) return win;
    return { ids: [], url: '', status: 0, body: '', via: 'none' };
  }

  const r = await shortTask();
  return r || { ids: [], url: '', status: 0, body: '' };
}

export async function onRequest(context) {
  const { request, env } = context;
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
    resolve(target, env).then(r => ({ ...r, timedout: false })),
    new Promise(res => setTimeout(() => res({ ids: [], url: '', status: 0, body: '', timedout: true }), 9000))
  ]);

  if (!winner.ids || winner.ids.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: winner.timedout ? 'timeout' : 'not found', tk }), { status: 200, headers: CORS });
  }

  return new Response(JSON.stringify({ ok: true, ids: winner.ids, url: winner.url, tk, via: winner.via || 'follow' }), { headers: CORS });
}
