// 线报聚合端点：拉取大淘客线报 → 批量转链（带 PID）→ 替换淘口令占位符 → 存 KV
//
// 路由：GET /api/line
//   mode=view      （默认）直接读 KV 缓存，秒开；缓存为空时自动拉一次
//   mode=refresh   立即拉取最新一页 + 转链 + 合并入库（用户点刷新）
//   mode=seed      回填历史（pageId 1..12），首次初始化用
//   mode=history&date=YYYYMMDD  读某天的归档
//
// 返回：{ ok, updatedAt, count, added, items:[{ id, text, pic, title, price, tpwd, url, time, sub, converted }] }

const API_LIST = 'https://openapi.dataoke.com/api/dels/spider/list-tip-off';
const API_LINK = 'https://openapi.dataoke.com/api/tb-service/get-privilege-link';

const K_LATEST = 'line:latest';
const K_META = 'line:meta';
const K_DAY = 'line:day:';
const MAX_ITEMS = 120;      // 本地保留上限（滚动）
const VIEW_TTL = 6 * 3600;  // 缓存超过 6 小时，下次打开自动补拉
const REFRESH_GAP = 15;     // 用户手动刷新最短间隔（秒）

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: CORS });

async function md5Hex(str) {
  const buf = await crypto.subtle.digest('MD5', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signParams(params, secret) {
  const items = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && String(params[k]) !== '')
    .sort()
    .map(k => `${k}=${params[k]}`);
  return (await md5Hex(items.join('&') + '&key=' + secret)).toUpperCase();
}

async function fetchJson(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, ms || 12000);
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal });
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function callApi(path, params, appKey, appSecret, timeout) {
  const p = { ...params, appKey };
  p.sign = await signParams(p, appSecret);
  return fetchJson(`${path}?${new URLSearchParams(p).toString()}`, timeout);
}

// 判断是否“凑单子项”（价格是叠加后的，单独发容易误导）
const isSub = (t) => /凑[単单]|加购一起拍/.test(String(t || '').slice(0, 30));

// 单条转链
async function convertOne(item, ctx) {
  if (!item.id) return item;
  try {
    const r = await callApi(API_LINK, {
      version: 'v1.3.1',
      goodsId: item.id,
      pid: ctx.pid,
    }, ctx.appKey, ctx.appSecret, 12000);

    const d = (r && r.data) || {};
    if (r && r.code === 0 && (d.shortUrl || d.tpwd)) {
      item.tpwd = d.tpwd || '';
      item.url = d.shortUrl || d.couponClickUrl || '';
      if (d.actualPrice) item.price = String(d.actualPrice);
      if (d.title) item.title = d.title;
      if (d.couponInfo) item.coupon = String(d.couponInfo);
      item.converted = true;
    }
  } catch (_) { /* 单条失败不影响整体 */ }

  // 无论成败都刷新一次成品文案：成功则填口令，失败保留原文案
  item.text = (item.raw || '').replace(/\[淘口令请转链\]/g, item.tpwd || '');
  return item;
}

// 并发池：Workers 单请求最多 6 个并发连接，取 5 留余量
async function convertAll(list, ctx, size = 5) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    const chunk = list.slice(i, i + size);
    const done = await Promise.all(chunk.map(it => convertOne(it, ctx)));
    out.push(...done);
  }
  return out;
}

function normItem(raw) {
  const txt = String(raw.contentCopy || raw.content || '');
  const pic = String(raw.picUrls || '').split(',')[0].trim();
  const firstLine = (String(raw.content || '').split('\n').find(l => l.trim()) || '').trim();
  return {
    id: raw.itemIds || '',
    raw: txt,
    text: txt,
    pic,
    title: firstLine.slice(0, 40),
    price: '',
    tpwd: '',
    url: '',
    time: raw.createTime || '',
    sub: isSub(txt),
    converted: false,
  };
}

async function pullPage(pageId, ctx) {
  const r = await callApi(API_LIST, {
    version: 'v4.0.0',
    pageId: String(pageId),
    pageSize: '20',
  }, ctx.appKey, ctx.appSecret, 15000);
  const list = ((r && r.data && r.data.list) || []);
  return list.map(normItem);
}

async function store(env, items, added) {
  const KV = env.KEY_STORE;
  const ts = Date.now();
  await KV.put(K_LATEST, JSON.stringify(items));
  await KV.put(K_META, JSON.stringify({ updatedAt: ts, count: items.length, added: added || 0 }));

  // 按天归档（只存当天新收的，供历史查询）
  const d = new Date(ts + 8 * 3600 * 1000); // 东八区
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const prev = (await KV.get(K_DAY + day, 'json')) || [];
  const have = new Set(prev.map(x => x.id));
  const merged = [...items.filter(x => !have.has(x.id)), ...prev].slice(0, 400);
  await KV.put(K_DAY + day, JSON.stringify(merged));
}

// goodsSign → 淘宝数字商品ID（跟随 uland 跳转），带 KV 永久缓存
async function resolveNumId(gid, env, ms) {
  if (!gid) return '';
  const key = 'line:num:' + gid;
  try {
    const hit = await env.KEY_STORE.get(key);
    if (hit) return hit;
  } catch (_) {}
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, ms || 8000);
    let resp;
    try {
      resp = await fetch('https://uland.taobao.com/item/edetail?id=' + encodeURIComponent(gid), {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        },
      });
    } finally { clearTimeout(timer); }
    const m = String(resp.url || '').match(/[?&]id=(\d{6,})/);
    if (m) {
      try { await env.KEY_STORE.put(key, m[1]); } catch (_) {}
      return m[1];
    }
  } catch (_) {}
  return '';
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response('', { headers: CORS });

  const KV = env.KEY_STORE;
  if (!KV) return json({ ok: false, error: '未绑定 KV（KEY_STORE）' }, 500);

  let appKey = env.DTK_APPKEY || '';
  let appSecret = env.DTK_APPSECRET || '';
  let pid = env.DTK_PID || '';
  if (!appKey || !appSecret || !pid) {
    const [k1, k2, k3] = await Promise.all([
      appKey ? Promise.resolve(appKey) : KV.get('dtk:appkey'),
      appSecret ? Promise.resolve(appSecret) : KV.get('dtk:appsecret'),
      pid ? Promise.resolve(pid) : KV.get('dtk:pid'),
    ]);
    appKey = appKey || k1 || '';
    appSecret = appSecret || k2 || '';
    pid = pid || k3 || '';
  }
  if (!appKey || !appSecret) return json({ ok: false, error: '未配置大淘客密钥' }, 500);
  if (!pid) return json({ ok: false, error: '未配置推广位 PID' }, 500);

  const ctx = { appKey, appSecret, pid };
  const sp = new URL(request.url).searchParams;
  const mode = (sp.get('mode') || 'view').toLowerCase();

  // 历史归档
  if (mode === 'history') {
    const day = (sp.get('date') || '').replace(/[^0-9]/g, '');
    if (!day) return json({ ok: false, error: '缺少 date=YYYYMMDD' }, 400);
    const arr = (await KV.get(K_DAY + day, 'json')) || [];
    return json({ ok: true, date: day, count: arr.length, items: arr });
  }

  // goodsSign → 淘宝数字商品ID
  if (mode === 'numid') {
    const gid = (sp.get('id') || '').trim();
    if (!/^[A-Za-z0-9_-]{10,}$/.test(gid)) return json({ ok: false, error: 'id 无效' }, 400);
    const num = await resolveNumId(gid, env, 8000);
    if (num) return json({ ok: true, numId: num });
    return json({ ok: false, error: '未能解析出数字ID' });
  }

  const [metaRaw, cachedRaw] = await Promise.all([
    KV.get(K_META, 'json'),
    KV.get(K_LATEST, 'json'),
  ]);
  const meta = metaRaw || { updatedAt: 0, count: 0 };
  const cached = cachedRaw || [];  const age = Math.floor((Date.now() - (meta.updatedAt || 0)) / 1000);

  // 直接读缓存
  if (mode === 'view') {
    // 缓存为空或过旧 → 后台补一次再返回，避免打开就是空列表
    if (!cached.length || age > VIEW_TTL) {
      try {
        const fresh = await pullPage(1, ctx);
        const conv = await convertAll(fresh, ctx);
        const mapped = new Map(cached.map(x => [x.id, x]));
        conv.forEach(x => mapped.set(x.id, x));
        const merged = Array.from(mapped.values())
          .sort((a, b) => String(b.time).localeCompare(String(a.time)))
          .slice(0, MAX_ITEMS);
        await store(env, merged, fresh.length);
        return json({ ok: true, source: 'live', updatedAt: Date.now(), count: merged.length, items: merged });
      } catch (e) {
        return json({ ok: true, source: 'cache', updatedAt: meta.updatedAt, count: cached.length, items: cached, warn: '拉取失败，展示缓存' });
      }
    }
    return json({ ok: true, source: 'cache', age, updatedAt: meta.updatedAt, count: cached.length, items: cached });
  }

  // 用户手动刷新 / 定时任务 / 回填
  if (mode === 'refresh' || mode === 'cron' || mode === 'seed') {
    const gap = mode === 'cron' ? 240 : REFRESH_GAP;
    if (mode !== 'seed' && age < gap) {
      return json({ ok: true, source: 'cache', age, throttled: true, updatedAt: meta.updatedAt, count: cached.length, items: cached });
    }

    // seed 支持两种：page=N 回填指定页（推荐，单次约 5 秒）；pages=N 连续回填（易超时，仅小批量用）
    const singlePage = parseInt(sp.get('page') || '0', 10);
    let pages = [1];
    if (mode === 'seed') {
      if (singlePage > 0) pages = [singlePage];
      else {
        const want = Math.max(1, Math.min(3, parseInt(sp.get('pages') || '1', 10) || 1));
        pages = Array.from({ length: want }, (_, i) => i + 1);
      }
    }
    const mapped = new Map(cached.map(x => [x.id, x]));
    let added = 0;

    for (const p of pages) {
      let batch = [];
      try { batch = await pullPage(p, ctx); } catch (_) { continue; }
      if (!batch.length) break;                       // 到头了
      // 已转过的不重复调接口
      const need = batch.filter(x => !mapped.has(x.id) || !mapped.get(x.id).converted);
      const conv = need.length ? await convertAll(need, ctx) : [];
      const convMap = new Map(conv.map(x => [x.id, x]));
      batch.forEach(x => {
        const old = mapped.get(x.id);
        if (convMap.has(x.id)) { mapped.set(x.id, convMap.get(x.id)); if (!old) added++; }
        else if (old) { /* 保留旧的转链结果 */ }
        else { mapped.set(x.id, x); added++; }
      });
      if (mode !== 'seed') break;   // refresh/cron 只拉最新一页
    }

    const merged = Array.from(mapped.values())
      .sort((a, b) => String(b.time).localeCompare(String(a.time)))
      .slice(0, mode === 'seed' ? 240 : MAX_ITEMS);

    await store(env, merged, added);

    // 定时任务顺带补齐数字ID，用户点二维码时就能秒出
    if (mode === 'cron') {
      const need = merged.filter(x => !x.numId && x.id).slice(0, 6);
      if (need.length) {
        const got = await Promise.all(need.map(x => resolveNumId(x.id, env, 6000).then(n => { if (n) x.numId = n; return !!n; })));
        if (got.some(Boolean)) await store(env, merged, 0);
      }
    }

    return json({ ok: true, source: 'live', updatedAt: Date.now(), count: merged.length, added, items: merged });
  }

  return json({ ok: false, error: 'unknown mode' }, 400);
}
