// huafei 自定义链接中转页
// 访问 /h/<key>?pid=<商品id>
// 从 KV 取 self key 对应的真实链接，替换 itemIds 后返回唤起淘宝的 HTML

function buildTransitHtml(realUrl) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>正在打开淘宝…</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
       text-align:center;padding:56px 16px;color:#333;background:#fff}
  .btn{margin-top:28px;padding:12px 30px;font-size:16px;color:#fff;background:#ff5000;
       border:0;border-radius:24px}
  #tip{color:#999;font-size:13px;margin-top:18px}
</style>
</head>
<body>
  <p>正在唤起淘宝 App…</p>
  <button class="btn" id="openBtn">手动打开淘宝</button>
  <p id="tip">若未自动打开，请点击上方按钮</p>
<script>
const REAL_URL = ${JSON.stringify(realUrl)};
function openTaobaoApp(url) {
  const tbopenUrl = 'tbopen://m.taobao.com/tbopen/index.html?action=ali.open.nav&h5Url=' + encodeURIComponent(url);
  const taobaoScheme = 'taobao://' + url.replace('https://', '');
  let appOpened = false;
  const visibilityHandler = function() { if (document.hidden) { appOpened = true; } };
  document.addEventListener('visibilitychange', visibilityHandler);
  function tryScheme(schemeUrl) {
    if (window.NativeBridge || (window.Android && typeof window.Android !== 'undefined')) {
      window.location.href = schemeUrl;
    } else {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = schemeUrl;
      document.body.appendChild(iframe);
      setTimeout(function() { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 3000);
    }
  }
  tryScheme(tbopenUrl);
  setTimeout(function() {
    if (appOpened) { document.removeEventListener('visibilitychange', visibilityHandler); return; }
    tryScheme(taobaoScheme);
  }, 1000);
}
window.onload = function() {
  openTaobaoApp(REAL_URL);
  document.getElementById('openBtn').addEventListener('click', function(){ openTaobaoApp(REAL_URL); });
};
</script>
</body>
</html>`;
}

function htmlResponse(body, status) {
    return new Response(body, {
        status: status || 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}

export async function onRequest(context) {
    const { request, env, params } = context;
    const key = params.key ? decodeURIComponent(params.key) : '';
    const url = new URL(request.url);
    const pid = url.searchParams.get('pid') || '';

    if (!key) {
        return htmlResponse('<p>用法：/h/&lt;key&gt;?pid=&lt;商品id&gt;</p>', 400);
    }

    if (!/^self_[a-z0-9]{6,}$/i.test(key)) {
        return htmlResponse('<p>无效的跳转标识：' + key + '</p>', 404);
    }

    const KV = env.KEY_STORE;
    if (!KV) {
        return htmlResponse('<p>服务未配置</p>', 500);
    }

    let target = await KV.get('hfself:' + key);

    if (!target) {
        return htmlResponse('<p>该二维码已失效，请重新生成</p>', 404);
    }

    if (pid) {
        target = target.replace(/itemIds=[^&]+/, 'itemIds=' + pid);
    }

    return htmlResponse(buildTransitHtml(target));
}
