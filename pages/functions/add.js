const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>链接录入 · 奖励汇总</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 24px; background: #f5f6f8; color: #1f2329; }
  @media (prefers-color-scheme: dark) { body { background: #16191d; color: #e6e8eb; } }
  .wrap { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8a9099; font-size: 13px; margin-bottom: 18px; }
  .card { background: #fff; border: 1px solid #e6e8eb; border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
  @media (prefers-color-scheme: dark) { .card { background: #1e2227; border-color: #2a2f36; } }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 4px; }
  .hint { font-size: 11px; color: #8a9099; font-weight: 400; margin-left: 6px; }
  input, select, textarea { width: 100%; padding: 9px 10px; border: 1px solid #d0d4d9; border-radius: 8px; font-size: 14px; background: #fff; color: inherit; }
  @media (prefers-color-scheme: dark) { input, select, textarea { background: #12151a; border-color: #2a2f36; } }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
  @media (max-width: 520px) { .grid2 { grid-template-columns: 1fr; } }
  button { margin-top: 18px; width: 100%; padding: 12px; border: 0; border-radius: 10px; background: #2b6cff; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; cursor: not-allowed; }
  .log { margin-top: 16px; font-size: 13px; padding: 12px; border-radius: 8px; white-space: pre-wrap; display: none; }
  .log.ok { display: block; background: #e7f7ec; color: #176a36; }
  .log.err { display: block; background: #fdecec; color: #b42318; }
  @media (prefers-color-scheme: dark) { .log.ok { background: #14301f; color: #7fe0a3; } .log.err { background: #311818; color: #ff9b94; } }
  .note { font-size: 12px; color: #6b7280; line-height: 1.6; }
  code { background: rgba(127,127,127,.15); padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>链接录入</h1>
  <div class="sub">提交后直接写入 data/links.csv，线上 /links 表格随即更新。本页面不存储任何密钥。</div>

  <div class="card">
    <div class="grid2">
      <div>
        <label>一级标题<span class="hint">决定整行配色与归类</span></label>
        <select id="level1">
          <option value="手动记录">手动记录（置顶）</option>
          <option value="秒杀区">秒杀区</option>
          <option value="百补区">百补区</option>
          <option value="入口区">入口区</option>
          <option value="自定义">自定义</option>
        </select>
      </div>
      <div>
        <label>二级标题<span class="hint">无则留空</span></label>
        <input id="subtitle" placeholder="如：肥料 / 其他">
      </div>
      <div>
        <label>奖励名<span class="hint">必填</span></label>
        <input id="name" placeholder="如：超值元宝">
      </div>
      <div>
        <label>每日次数</label>
        <input id="daily" placeholder="如：1">
      </div>
      <div>
        <label>deliveryId</label>
        <input id="did" placeholder="留空表示无 / 手动记录">
      </div>
      <div>
        <label>sceneId</label>
        <input id="sid" placeholder="留空表示无">
      </div>
      <div>
        <label>是否使用</label>
        <select id="used"><option value="是">是</option><option value="否">否</option></select>
      </div>
      <div>
        <label>状态</label>
        <select id="status"><option value="">（空）</option><option value="待测">待测</option><option value="可用">可用</option></select>
      </div>
      <div>
        <label>链接<span class="hint">第9列</span></label>
        <input id="link" placeholder="https://... 留空可">
      </div>
      <div>
        <label>原链接<span class="hint">第10列，手动维护</span></label>
        <input id="orig" placeholder="https://... 留空可">
      </div>
    </div>
    <button id="submit">提交写入</button>
    <div id="log" class="log"></div>
  </div>

  <div class="card">
    <div class="note">
      <b>使用须知</b><br>
      1. 若填了 deliveryId 且该值已存在于 HTML 功能区，系统会把它认领为「自动行」——此时本行只贡献第 10 列「原链接」，不再作为独立手动行置顶。想让它作为干净的手动记录行存活，请用 HTML 里没有的 deliveryId 或留空。<br>
      2. 「原链接」列用于为线上已有按钮补充原始链接，由 CSV 维护、HTML 不覆盖。<br>
      3. 提交成功后，线上 /links 会实时（或等 CDN 缓存刷新后）显示新行，通常无需重新部署。
    </div>
  </div>
</div>

<script>
const $ = id => document.getElementById(id);
async function submit() {
  const btn = $("submit"), log = $("log");
  const payload = {
    level1: $("level1").value, subtitle: $("subtitle").value.trim(),
    name: $("name").value.trim(), daily: $("daily").value.trim(),
    did: $("did").value.trim(), sid: $("sid").value.trim(),
    used: $("used").value, status: $("status").value,
    link: $("link").value.trim(), orig: $("orig").value.trim()
  };
  if (!payload.name) { log.className = "log err"; log.textContent = "奖励名不能为空"; return; }
  btn.disabled = true; log.className = "log"; log.textContent = "写入中…";
  try {
    const r = await fetch("/api/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (data.ok) {
      log.className = "log ok"; log.textContent = "✓ 提交成功\\n" + (data.note || "");
      ["subtitle","name","daily","did","sid","link","orig"].forEach(k => $(k).value = "");
    } else {
      log.className = "log err"; log.textContent = "✗ " + (data.error || ("HTTP " + r.status));
    }
  } catch (e) {
    log.className = "log err"; log.textContent = "✗ 网络错误：" + e.message;
  } finally { btn.disabled = false; }
}
$("submit").addEventListener("click", submit);
</script>
</body>
</html>`;

export async function onRequestGet() {
  return new Response(HTML, {
    headers: { "content-type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type"
    }
  });
}
