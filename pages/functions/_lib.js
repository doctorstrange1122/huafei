// 共享逻辑：从在线文档自动解析按钮链接 + 构造中转页
const DOC_URL = 'https://raw.githubusercontent.com/doctorstrange1122/huafei/main/super/index.html';
const CACHE_TTL = 300; // 秒，5 分钟内复用缓存
let cacheMap = null;
let cacheTime = 0;

export function parseButtonMap(html) {
  // 解析 generateQRCodes(数量, '真实URL', '标签', 'key')
  // 第5参数（如 skipCount=true）可选：8点秒杀走中转但不计数，调用形如 generateQRCodes(1,'URL','label','key',true)
  const re = /generateQRCodes\(\s*\d+\s*,\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*'([^']+)'\s*(?:,[^)]*)?\)/g;
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
  // 内联 super/index.html 结果区 openTaobaoApp 逻辑（tbopen 唯一自动协议，不补发任何其他协议）
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
  // 在淘宝/一淘 App 内（如用淘宝“扫一扫”打开本中转页）：其 WebView 会二次解析
  // tbopen 携带的 h5Url，导致同时打开“目标页 + 随机页（如好运签）”。
  // 故在淘宝/一淘 WebView 内直接 location.replace 真实链接（单页），不再使用 tbopen。
  const isInsideTaobao = /AliApp\\(TB|AliApp\\(TM|taobao|etao/i.test(navigator.userAgent);
  if (isInsideTaobao) {
    location.replace(url);
    return;
  }
  // tbopen:// 是淘宝官方 Deep Link，鸿蒙兼容性最好——唯一自动唤起协议。
  // 曾用裸 taobao:// 做兜底，但淘宝冷启动（用户清过后台）时 2.5s 内收不到"已打开"信号，
  // 兜底被误发，淘宝接单后弹"为你推荐了一个新的页面"降级页并压在活动页下方；
  // 且鸿蒙安卓兼容层的 UA 不含 HarmonyOS，靠 UA 禁兜底不可靠。故彻底移除兜底：
  // 只发 tbopen，活动页打开即终止，不再补发任何其他协议。
  const tbopenUrl = 'tbopen://m.taobao.com/tbopen/index.html?action=ali.open.nav&h5Url=' + encodeURIComponent(url);
  // iPadOS 14+ 的 UA 是 MacIntel，需结合触摸点判断
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAPK = !!window.NativeBridge || (window.Android && typeof window.Android !== 'undefined');

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
    // 唯一自动唤起：tbopen://，不补发任何其他协议
    fire(tbopenUrl);
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
