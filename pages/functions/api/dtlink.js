// 大淘客「万能解析转链」——输入商品链接/淘口令/goodsSign，一步返回【带券 + 带PID归因】的推广短链
// 文档: https://www.dataoke.com/kfpt/api-d.html  (接口 /api/tb-service/parse-content)
//
// 密钥（二选一，优先环境变量）：
//   环境变量：DTK_APPKEY、DTK_APPSECRET、DTK_PID(可选，默认推广位)
//   KV KEY_STORE：dtk:appkey、dtk:appsecret、dtk:pid
//
// 路由：GET /api/dtlink?content=商品链接或淘口令或goodsSign[&pid=mm_xxx][&promtionType=2][&debug=1]
// 返回：{ ok, goodsId, itemName, commissionRate, shortUrl, shortTpwd, couponLink, cpsLongUrl, cpsFullTpwd }
//   shortUrl   -> s.click.taobao.com 推广短链（带 PID，可直接生成二维码）
//   shortTpwd  -> 券后淘口令（形如 "99￥ HU293 xxxxx￥"，面额为券额）
//   couponLink -> 公开领券页（不带归因，仅作展示/兜底）

const API = 'https://openapi.dataoke.com/api/tb-service/parse-content';
const API_DETAIL = 'https://openapi.dataoke.com/api/goods/get-goods-details';
const API_COUPON = 'https://openapi.dataoke.com/api/dels/taobao/kit/coupon/get-coupon-info';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}

async function md5Hex(str) {
  const buf = await crypto.subtle.digest('MD5', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 大淘客验签：非空参数按 key ASCII 升序拼 k=v&...，末尾 &key=SECRET，MD5 大写
async function signParams(params, secret) {
  const items = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && String(params[k]) !== '')
    .sort()
    .map(k => `${k}=${params[k]}`);
  const raw = items.join('&') + '&key=' + secret;
  return (await md5Hex(raw)).toUpperCase();
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response('', { headers: CORS });

  const sp = new URL(request.url).searchParams;
  const KV = env.KEY_STORE;

  let appKey = env.DTK_APPKEY || '';
  let appSecret = env.DTK_APPSECRET || '';
  let defPid = env.DTK_PID || '';
  if ((!appKey || !appSecret) && KV) {
    try {
      appKey = appKey || (await KV.get('dtk:appkey')) || '';
      appSecret = appSecret || (await KV.get('dtk:appsecret')) || '';
      defPid = defPid || (await KV.get('dtk:pid')) || '';
    } catch (_) {}
  }
  if (!appKey || !appSecret) {
    return json({ ok: false, error: '未配置 DTK_APPKEY / DTK_APPSECRET（环境变量或 KV dtk:appkey / dtk:appsecret）' }, 500);
  }

  let content = (sp.get('content') || sp.get('url') || sp.get('tkl') || '').trim();
  if (!content) return json({ ok: false, error: 'missing content（商品链接 / 淘口令 / goodsSign）' }, 400);

  // 纯数字商品ID：大淘客只认商品链接/口令，裸ID需先转成商品详情页链接
  if (/^\d{6,}$/.test(content)) {
    content = 'https://item.taobao.com/item.htm?id=' + content;
  }

  const pid = (sp.get('pid') || defPid || '').trim();
  const params = {
    appKey,
    version: sp.get('version') || 'v1.0.0',
    content,
  };
  if (pid) {
    params.pid = pid;
    params.promtionType = sp.get('promtionType') || '2'; // 2=推广赚
  }

  try {
    const sign = await signParams(params, appSecret);
    const qs = new URLSearchParams({ ...params, sign }).toString();
    const resp = await fetch(`${API}?${qs}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const r = await resp.json();
    const d = (r && r.data) || null;

    if (r.code !== 0 || !d) {
      return json({
        ok: false,
        code: r.code,
        error: r.msg || '接口无数据',
        hint: (r.code === 0 ? '该 PID 未在大淘客完成淘宝授权，或商品不支持转链' : undefined),
      });
    }

    const out = {
      ok: !!d.shortUrl,
      goodsId: d.goodsId || '',
      itemName: d.itemName || '',
      commissionRate: d.commissionRate || '',
      shortUrl: d.shortUrl || '',
      shortTpwd: d.shortTpwd || '',
      couponLink: d.couponLink || '',
      cpsLongUrl: d.cpsLongUrl || '',
      cpsFullTpwd: d.cpsFullTpwd || '',
    };

    // 附加商品详情（券后价 / 原价 / 券额 / 门槛 / 月销 / 店铺）——失败不影响转链结果
    if (d.goodsId && sp.get('detail') !== '0') {
      try {
        const dp = { appKey, version: 'v1.2.3', id: d.goodsId };
        const dsign = await signParams(dp, appSecret);
        const dresp = await fetch(`${API_DETAIL}?${new URLSearchParams({ ...dp, sign: dsign }).toString()}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const dj = await dresp.json();
        const dd = (dj && dj.data) || null;
        if (dj.code === 0 && dd) {
          out.title = dd.title || '';
          out.originalPrice = dd.originalPrice || '';
          out.actualPrice = dd.actualPrice || '';
          out.couponPrice = dd.couponPrice || '';
          out.couponConditions = dd.couponConditions || '';
          out.monthSales = dd.monthSales || '';
          out.shopName = dd.shopName || '';
          out.mainPic = dd.mainPic || '';
          if (dd.commissionRate) out.commissionRate = dd.commissionRate;
        }
      } catch (_) {}
    }

    // 兜底：老商品ID 拿不到详情时，用券查询接口补齐券额/门槛/领券链接
    if (!out.couponPrice && sp.get('detail') !== '0') {
      try {
        const cp = { appKey, version: 'v1.0.0', content };
        const csign = await signParams(cp, appSecret);
        const cresp = await fetch(`${API_COUPON}?${new URLSearchParams({ ...cp, sign: csign }).toString()}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const cj = await cresp.json();
        const cd = (cj && cj.data) || null;
        if (cj.code === 0 && cd) {
          if (Number(cd.couponAmount) > 0) out.couponPrice = cd.couponAmount;
          if (cd.couponConditions) out.couponConditions = cd.couponConditions;
          if (cd.couponLink && !out.couponLink) out.couponLink = cd.couponLink;
          if (cd.couponReceiveNum) out.couponReceiveNum = cd.couponReceiveNum;
        }
      } catch (_) {}
    }

    if (!out.shortUrl) {
      out.error = '该商品未加入淘客推广计划（无佣金），无法生成带归因的推广链';
      out.hint = '可换一个有佣金的同款商品，或直接用原链接';
    }

    if (sp.get('debug') === '1') out.raw = d;
    return json(out);
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
