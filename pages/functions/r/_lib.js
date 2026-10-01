// 共享逻辑：从在线文档自动解析按钮链接 + 构造中转页
const DOC_URL = 'https://raw.githubusercontent.com/doctorstrange1122/huafei/main/super/index.html';
const CACHE_TTL = 300; // 秒，5 分钟内复用缓存
let cacheMap = null;
let cacheTime = 0;

export function parseButtonMap(html) {
  // 解析 generateQRCodes(数量, '真实URL', '标签', 'key')
  const re = /generateQRCodes\(\s*\d+\s*,\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*'([^']+)'\s*\)/g;
  const map = {};
  let m;
  while ((m = re.exec(html)) !== null) {
    map[m[3]] = { url: m[1], label: m[2] };
  }
  return map;
}

export async function getButtonMap(force = false) {
  const now = Date.now();
  if (!force && cacheMap && (now - cacheTime) < CACHE_TTL * 1000) return cacheMap;
  try {
    const res = await fetch(DOC_URL, { cf: { cacheTtl: 300 } });
    if (!res.ok) throw new Error('doc fetch ' + res.status);
    const html = await res.text();
    const map = parseButtonMap(html);
    cacheMap = map;
    cacheTime = now;
    return map;
  } catch (e) {
    if (cacheMap) return cacheMap; // 拉取失败退回上次缓存
    throw e;
  }
}

export function forceRefresh() {
  cacheMap = null;
  cacheTime = 0;
}

export function buildTransitHtml(realUrl) {
  // 内联 super/index.html 结果区 openTaobaoApp 逻辑（tbopen 优先 + taobao:// 回落）
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
const REAL_URL = ${JSON.stringify(realUrl).replace(/</g, '\\u003c')};
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
