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
  /* iOS 手势遮罩：Safari 禁止无手势唤起 scheme，需用户点击触发 */
  #iosMask{position:fixed;inset:0;display:none;flex-direction:column;align-items:center;
           justify-content:center;background:rgba(0,0,0,.6);color:#fff;z-index:999;cursor:pointer}
  #iosMask .big{font-size:20px;margin-bottom:10px}
  #iosMask .sub{font-size:14px;opacity:.85}
</style>
</head>
<body>
  <p>正在唤起淘宝 App…</p>
  <button class="btn" id="openBtn">手动打开淘宝</button>
  <p id="tip">若未自动打开，请点击上方按钮</p>
  <div id="iosMask"><div class="big">点击打开淘宝 App</div><div class="sub">如已安装将自动跳转</div></div>
<script>
const REAL_URL = ${JSON.stringify(realUrl).replace(/</g, '\\u003c')};
function openTaobaoApp(url) {
  const tbopenUrl = 'tbopen://m.taobao.com/tbopen/index.html?action=ali.open.nav&h5Url=' + encodeURIComponent(url);
  const taobaoScheme = 'taobao://' + url.replace('https://', '');
  // iPadOS 14+ 的 UA 是 MacIntel，需结合触摸点判断
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAPK = !!window.NativeBridge || (window.Android && typeof window.Android !== 'undefined');
  let appOpened = false;
  const visibilityHandler = function() { if (document.hidden) { appOpened = true; } };
  document.addEventListener('visibilitychange', visibilityHandler);
  // iOS Safari 必须用 location.href，且在用户手势中触发；iframe 方式对 iOS 无效
  function fire(schemeUrl) {
    if (isIOS || isAPK) {
      window.location.href = schemeUrl;
    } else {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = schemeUrl;
      document.body.appendChild(iframe);
      setTimeout(function() { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 3000);
    }
  }
  function go() {
    if (appOpened) { return; }
    fire(tbopenUrl);
    setTimeout(function() { if (!appOpened) { fire(taobaoScheme); } }, 1000);
  }
  if (isIOS) {
    // 自动试一次（多数被 Safari 拦截），弹出手势遮罩兜底
    go();
    const mask = document.getElementById('iosMask');
    mask.style.display = 'flex';
    mask.addEventListener('click', go);
  } else {
    go();
  }
  document.getElementById('openBtn').addEventListener('click', go);
}
window.onload = function() {
  openTaobaoApp(REAL_URL);
};
</script>
</body>
</html>`;
}
