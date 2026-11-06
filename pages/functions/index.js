export async function onRequestGet() {
  return new Response(`<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>huafei 中转服务</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;text-align:center;padding:48px 16px;color:#333;background:#fff">
  <h2>huafei 二维码中转服务</h2>
  <p>这是中转服务根页面，正常访问请通过二维码扫描 <code>/r/&lt;按钮key&gt;?pid=&lt;商品id&gt;</code> 路径。</p>
  <p><a href="/keys">查看已同步的按钮列表</a></p>
</body>
</html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
