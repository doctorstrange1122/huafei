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
    const res = await fetch(DOC_URL, { cache: 'no-store' });
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
  // 内联 super/index.html 结果区 openTaobaoApp 逻辑（tbopen 唯一自动协议 + 多信号探测 + 鸿蒙禁裸 scheme 兜底）
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
  // tbopen:// 是淘宝官方 Deep Link，鸿蒙兼容性最好——唯一自动唤起协议
  const tbopenUrl = 'tbopen://m.taobao.com/tbopen/index.html?action=ali.open.nav&h5Url=' + encodeURIComponent(url);
  // taobao:// 裸 scheme 仅作远古设备兜底（tbopen 未注册时）；鸿蒙上它只会弹淘宝推荐页，禁止补发
  const taobaoScheme = 'taobao://' + url.replace('https://', '');
  // iPadOS 14+ 的 UA 是 MacIntel，需结合触摸点判断
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAPK = !!window.NativeBridge || (window.Android && typeof window.Android !== 'undefined');
  // 鸿蒙（系统浏览器/WebView UA 含 HarmonyOS/OpenHarmony）
  const isHarmonyOS = /HarmonyOS|OpenHarmony/i.test(navigator.userAgent);

  // “App 已打开”多信号探测：
  // 仅靠 visibilitychange 在鸿蒙不可靠——tbopen 成功唤起淘宝后浏览器不派发可见性事件，
  // 旧逻辑 1s 后补发 taobao://，被淘宝接单弹出“为你推荐了一个新的页面”（活动页后方多一个页面）。
  // 现叠加：pagehide/blur 事件 + hasFocus 失焦轮询 + rAF 心跳停摆轮询，任一信号即认定已打开。
  let appOpened = false;
  let lastTick = Date.now();
  let pollTimer = null;
  let fallbackTimer = null;
  function markOpened() { appOpened = true; }
  (function heartbeat() { lastTick = Date.now(); requestAnimationFrame(heartbeat); })();
  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function() {
      if (!document.hasFocus() || Date.now() - lastTick > 600) markOpened();
    }, 200);
  }
  document.addEventListener('visibilitychange', function() { if (document.hidden) markOpened(); });
  window.addEventListener('pagehide', markOpened);
  window.addEventListener('blur', markOpened);
  startPoll();

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
  function go(force) {
    // 手动点击（按钮/遮罩）= 用户明确要求重试：重置探测状态，重新走完整流程
    if (force) {
      appOpened = false;
      lastTick = Date.now();
      startPoll();
    }
    fire(tbopenUrl);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(function() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      // 已探测到 App 打开、或鸿蒙（裸 scheme 只会弹推荐页）→ 停止，不再补发任何其他协议
      if (appOpened || isHarmonyOS) return;
      fire(taobaoScheme);
    }, 2500);
  }
  if (isIOS) {
    // 自动试一次（多数被 Safari 拦截），弹出手势遮罩兜底
    go();
    const mask = document.getElementById('iosMask');
    mask.style.display = 'flex';
    mask.addEventListener('click', function() { go(true); });
  } else {
    go();
  }
  document.getElementById('openBtn').addEventListener('click', function() { go(true); });
}
window.onload = function() {
  openTaobaoApp(REAL_URL);
};
</script>
</body>
</html>`;
}
