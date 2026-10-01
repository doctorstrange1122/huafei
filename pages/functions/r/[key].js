import { getButtonMap, buildTransitHtml } from './_lib.js';

export async function onRequestGet(context) {
  const { request, params } = context;
  const key = params.key;
  const url = new URL(request.url);
  const pid = url.searchParams.get('pid');
  const scheme = url.searchParams.get('scheme'); // 'taobao' 强制裸 scheme（仅安卓，鸿蒙不兼容）

  // key='self'：自定义链接，真实 URL 由 url 参数携带，跳过在线文档查表
  if (key === 'self') {
    const realUrl = url.searchParams.get('url'); // 已自动解码
    if (!realUrl) return new Response('缺少 url 参数', { status: 400 });
    if (!/^https?:\/\//i.test(realUrl)) return new Response('非法链接', { status: 400 });
    if (scheme === 'taobao') {
      const taobaoUrl = 'taobao://' + realUrl.replace('https://', '');
      return Response.redirect(taobaoUrl, 302);
    }
    return new Response(buildTransitHtml(realUrl), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  let map;
  try {
    map = await getButtonMap();
  } catch (e) {
    return new Response('中转服务暂不可用：无法读取在线文档', { status: 503 });
  }

  const entry = map[key];
  if (!entry) {
    return new Response('未找到该按钮 key: ' + key, { status: 404 });
  }

  let target = entry.url;
  if (pid) {
    target = target.replace(/itemIds=[^&]+/, 'itemIds=' + pid);
  }

  // scheme=taobao 时直接返回裸 scheme 重定向（安卓兼容，鸿蒙不行）——默认走 HTML 中转页
  if (scheme === 'taobao') {
    const taobaoUrl = 'taobao://' + target.replace('https://', '');
    return Response.redirect(taobaoUrl, 302);
  }

  const html = buildTransitHtml(target);
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
