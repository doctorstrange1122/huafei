import { getButtonMap, buildTransitHtml } from '../_lib.js';

export async function onRequestGet(context) {
  const { request, params } = context;
  const key = params.key;
  const url = new URL(request.url);
  const pid = url.searchParams.get('pid');
  const scheme = url.searchParams.get('scheme'); // 'taobao' 强制裸 scheme（仅安卓，鸿蒙不兼容）

  let map;
  try {
    map = await getButtonMap();
  } catch (e) {
    return new Response('中转服务暂不可用：无法读取在线文档', { status: 503 });
  }

  const entry = map[key];
  if (!entry) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif;text-align:center;padding:56px 16px;color:#333;background:#fff"><h3>该二维码已失效，请重新生成</h3></body>',
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
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
