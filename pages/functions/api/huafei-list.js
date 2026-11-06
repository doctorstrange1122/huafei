// 列出所有 huafei 自定义链接（KV KEY_STORE 中 hfself:* 前缀）
// 只读接口，供 huafei /links 表格渲染自定义链接区使用
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response('', { headers: CORS });

  const KV = env.KEY_STORE;
  if (!KV) {
    return new Response(JSON.stringify({ success: false, message: 'KV 未配置' }), { status: 500, headers: CORS });
  }

  try {
    const items = [];
    let cursor;
    do {
      const opts = { prefix: 'hfself:' };
      if (cursor) opts.cursor = cursor;
      const res = await KV.list(opts);
      for (const k of res.keys) {
        const url = await KV.get(k.name);
        if (url) items.push({ key: k.name.replace(/^hfself:/, ''), url });
      }
      cursor = res.list_complete ? undefined : res.cursor;
    } while (cursor);

    return new Response(JSON.stringify({ success: true, items }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, message: e.message }), { status: 500, headers: CORS });
  }
}
