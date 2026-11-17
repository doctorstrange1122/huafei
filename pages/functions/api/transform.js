// 淘宝官方「旧商品ID → 新商品ID」转换
// taobao.tbk.itemid.share.transform (商品id升级-三方, 免费免授权)
// taobao.tbk.itemid.ineffective.transform (失效商品id转化, 免费免授权)
// 环境变量: TB_APP_KEY, TB_APP_SECRET
// 路由: /api/transform?item_ids=旧ID1,旧ID2&method=taobao.tbk.itemid.share.transform
const API_URL = 'https://eco.taobao.com/router/rest';

async function md5(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('MD5', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function sign(params, secret) {
  const sorted = Object.keys(params).sort();
  let s = secret;
  for (const k of sorted) s += k + params[k];
  s += secret;
  return (await md5(s)).toUpperCase();
}
async function topCall(method, appKey, appSecret, fields) {
  const now = new Date();
  const ts = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + ' ' + String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
  const params = {
    method, app_key: appKey, timestamp: ts, format: 'json', v: '2.0',
    sign_method: 'md5', ...fields,
  };
  params.sign = await sign(params, appSecret);
  const body = new URLSearchParams(params).toString();
  const resp = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  return resp.json();
}

export async function onRequest(context) {
  const { request, env } = context;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Content-Type': 'application/json; charset=utf-8' };
  if (request.method === 'OPTIONS') return new Response('', { headers: cors });
  const sp = new URL(request.url).searchParams;
  const appKey = env.TB_APP_KEY, appSecret = env.TB_APP_SECRET;
  if (!appKey || !appSecret) return new Response(JSON.stringify({ ok: false, error: '未配置 TB_APP_KEY/TB_APP_SECRET' }), { status: 500, headers: cors });

  const itemIds = sp.get('item_ids') || '';
  const method = sp.get('method') || 'taobao.tbk.itemid.share.transform';
  if (!itemIds) return new Response(JSON.stringify({ ok: false, error: 'missing item_ids' }), { status: 400, headers: cors });

  try {
    const r = await topCall(method, appKey, appSecret, { item_ids: itemIds });
    if (r.error_response) {
      return new Response(JSON.stringify({ ok: false, error: (r.error_response.sub_msg || r.error_response.msg), sub_code: r.error_response.sub_code, raw: r }), { headers: cors });
    }
    const key = method === 'taobao.tbk.itemid.ineffective.transform'
      ? 'tbk_itemid_ineffective_transform_response'
      : 'tbk_itemid_share_transform_response';
    const resp = r[key];
    const results = resp && (resp.results || resp.item_id_transform_dto);
    if (results) {
      return new Response(JSON.stringify({ ok: true, method, results, raw: resp }), { headers: cors });
    }
    return new Response(JSON.stringify({ ok: true, method, raw: r }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: cors });
  }
}
