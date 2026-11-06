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

  let entry = map[key];
  if (!entry) {
    // 可能命中了旧的内存缓存，强制刷新后再查一次
    try {
      map = await getButtonMap(true);
      entry = map[key];
    } catch (e) {
      // 刷新失败仍用旧 map，entry 保持 undefined
    }
  }
  if (!entry) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,BlinkMacSystemFont,\'PingFang SC\',sans-serif;text-align:center;padding:56px 16px;color:#333;background:#fff"><h3>该二维码已失效，请重新生成</h3></body>',
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  let target = entry.url;
  if (pid) {
    target = target.replace(/itemIds=[^&]+/, 'itemIds=' + pid);
    // itemId=（单数，query 形式）：8点秒杀模板 tbms-limited-grad/detail 使用的参数
    target = target.replace(/([?&]itemId=)\d+/, '$1' + pid);
  }
  // batchId 前 8 位改为当天日期（中国时区 UTC+8；仅对含 batchId 的链接生效，如 8点秒杀模板，
  // 形如 batchId=202610172000 → 当天8位+2000）。无 batchId 的按钮链接不受影响。
  const nowCn = new Date(Date.now() + 8 * 3600 * 1000);
  const today8 = nowCn.toISOString().slice(0, 10).replace(/-/g, '');
  target = target.replace(/(batchId=)\d{8}/, '$1' + today8);

  // scheme=taobao 时直接返回裸 scheme 重定向（安卓兼容，鸿蒙不行）——默认走 HTML 中转页
  if (scheme === 'taobao') {
    const taobaoUrl = 'taobao://' + target.replace('https://', '');
    return Response.redirect(taobaoUrl, 302);
  }

  const html = buildTransitHtml(target);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 中转页逻辑更新频繁，禁止任何中间层/浏览器缓存旧版跳转代码
      'Cache-Control': 'no-store',
    },
  });
}
