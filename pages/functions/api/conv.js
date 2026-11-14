// 淘宝联盟官方「商品链接转换」(taobao.tbk.item.convert) —— 给商品id加PID归因，生成带佣金的推广链接/口令
// 环境变量: TB_APP_KEY, TB_APP_SECRET
// 路由: /api/conv?num_iid=商品id&pid=推广位(mm_xxx)&method=taobao.tbk.item.convert
// 返回: { ok, click_url, coupon_click_url, tpwd, raw }
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

  const numIid = sp.get('num_iid') || '';
  const pid = sp.get('pid') || env.TB_PID || '';
  if (!numIid) return new Response(JSON.stringify({ ok: false, error: 'missing num_iid' }), { status: 400, headers: cors });

  const fields = { num_iid: numIid, platform: '2' };
  if (pid) fields.pid = pid;

  try {
    const r = await topCall('taobao.tbk.item.convert', appKey, appSecret, fields);
    if (r.error_response) {
      return new Response(JSON.stringify({ ok: false, error: (r.error_response.sub_msg || r.error_response.msg), raw: r }), { status: 200, headers: cors });
    }
    const data = r.tbk_item_convert_response && r.tbk_item_convert_response.result_data;
    if (data) {
      return new Response(JSON.stringify({
        ok: true,
        click_url: data.click_url || '',
        coupon_click_url: data.coupon_click_url || '',
        raw: data,
      }), { headers: cors });
    }
    return new Response(JSON.stringify({ ok: false, error: '无返回数据', raw: r }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: cors });
  }
}
