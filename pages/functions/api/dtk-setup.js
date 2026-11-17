// 【临时】一次性写入大淘客密钥到 KV，用完立即删除
export async function onRequest({ request, env }) {
  const CORS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const KV = env.KEY_STORE;
  if (!KV) return new Response(JSON.stringify({ ok: false, error: 'KV 未配置' }), { status: 500, headers: CORS });
  const sp = new URL(request.url).searchParams;
  const appkey = sp.get('appkey') || '';
  const appsecret = sp.get('appsecret') || '';
  const pid = sp.get('pid') || '';
  if (!appkey || !appsecret) return new Response(JSON.stringify({ ok: false, error: 'missing appkey/appsecret' }), { status: 400, headers: CORS });
  await KV.put('dtk:appkey', appkey);
  await KV.put('dtk:appsecret', appsecret);
  if (pid) await KV.put('dtk:pid', pid);
  return new Response(JSON.stringify({ ok: true, wrote: ['dtk:appkey', 'dtk:appsecret', pid ? 'dtk:pid' : null].filter(Boolean) }), { headers: CORS });
}
