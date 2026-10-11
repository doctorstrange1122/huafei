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
  /* 现有记录列表 */
  .list-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .list-title { font-size: 15px; font-weight: 700; }
  .list-refresh { width: auto; margin: 0; padding: 6px 14px; font-size: 13px; border-radius: 8px; background: #eef1f5; color: #333; }
  @media (prefers-color-scheme: dark) { .list-refresh { background: #2a2f36; color: #ddd; } }
  .rec-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #e6e8eb; border-radius: 8px; margin-bottom: 8px; font-size: 13px; }
  @media (prefers-color-scheme: dark) { .rec-row { border-color: #2a2f36; } }
  .rec-tag { flex: none; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 6px; background: #eceff3; color: #555; }
  .rec-tag.zdy { background: #efeafc; color: #6c4fd8; }
  @media (prefers-color-scheme: dark) { .rec-tag { background: #2a2f36; color: #bbb; } .rec-tag.zdy { background: #2c2545; color: #b9a5f0; } }
  .rec-main { flex: 1; min-width: 0; }
  .rec-name { font-weight: 600; }
  .rec-sub { color: #8a9099; font-size: 12px; margin-top: 2px; word-break: break-all; }
  .rec-del { flex: none; width: auto; margin: 0; padding: 6px 14px; font-size: 13px; border-radius: 8px; background: #e5484d; }
  .rec-del:disabled { background: #b95c60; }
  .rec-empty { color: #8a9099; font-size: 13px; padding: 12px 0; text-align: center; }
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
    <div class="list-head">
      <div class="list-title">现有手动 / 自定义记录</div>
      <button type="button" class="list-refresh" id="refreshRows">刷新列表</button>
    </div>
    <div id="recList"><div class="rec-empty">加载中…</div></div>
  </div>

  <div class="card">
    <div class="note">
      <b>使用须知</b><br>
      1. 若填了 deliveryId 且该值已存在于 HTML 功能区，系统会把它认领为「自动行」——此时本行只贡献第 10 列「原链接」，不再作为独立手动行置顶。想让它作为干净的手动记录行存活，请用 HTML 里没有的 deliveryId 或留空。<br>
      2. 「原链接」列用于为线上已有按钮补充原始链接，由 CSV 维护、HTML 不覆盖。<br>
      3. 提交成功后，线上 /links 会实时（或等 CDN 缓存刷新后）显示新行，通常无需重新部署。<br>
      4. 「现有手动 / 自定义记录」卡片中可删除行，仅支持删除一级标题为「手动记录」「自定义」的行；秒杀区 / 百补区 / 入口区行由 HTML 按钮自动生成，不在此处管理。
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
// ====== 现有记录列表 / 删除 ======
async function loadRows() {
  const box = $("recList");
  box.innerHTML = '<div class="rec-empty">加载中…</div>';
  try {
    const r = await fetch("/api/delete", { headers: { "Content-Type": "application/json" } });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || ("HTTP " + r.status));
    if (!data.rows.length) { box.innerHTML = '<div class="rec-empty">暂无手动 / 自定义记录</div>'; return; }
    box.innerHTML = "";
    for (const row of data.rows) {
      const div = document.createElement("div");
      div.className = "rec-row";
      const isZdy = row.level1 === "自定义";
      const subParts = [];
      if (row.did) subParts.push("did=" + row.did);
      if (row.sid) subParts.push("sid=" + row.sid);
      if (row.daily) subParts.push("每日" + row.daily + "次");
      if (row.link) subParts.push(row.link);
      div.innerHTML =
        '<span class="rec-tag' + (isZdy ? " zdy" : "") + '">' + escHtml(row.level1) + "</span>" +
        '<div class="rec-main"><div class="rec-name">' + escHtml(row.name) + "</div>" +
        (subParts.length ? '<div class="rec-sub">' + escHtml(subParts.join(" · ")) + "</div>" : "") + "</div>" +
        '<button type="button" class="rec-del">删除</button>';
      div.querySelector(".rec-del").addEventListener("click", () => delRow(row, div));
      box.appendChild(div);
    }
  } catch (e) {
    box.innerHTML = '<div class="rec-empty">加载失败：' + escHtml(e.message) + "</div>";
  }
}
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
async function delRow(row, rowEl) {
  const btn = rowEl.querySelector(".rec-del");
  const tip = row.did ? ("deliveryId=" + row.did) : "无 deliveryId";
  if (!confirm("确认删除「" + row.level1 + " / " + row.name + "」（" + tip + "）？\n删除后会直接写入 data/links.csv，无法恢复。")) return;
  btn.disabled = true; btn.textContent = "删除中…";
  try {
    const r = await fetch("/api/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row)
    });
    const data = await r.json();
    if (data.ok) {
      btn.textContent = "已删除";
      rowEl.style.opacity = ".45";
      setTimeout(loadRows, 600);
    } else {
      alert("删除失败：" + (data.error || ("HTTP " + r.status)));
      btn.disabled = false; btn.textContent = "删除";
    }
  } catch (e) {
    alert("网络错误：" + e.message);
    btn.disabled = false; btn.textContent = "删除";
  }
}
$("refreshRows").addEventListener("click", loadRows);
loadRows();
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
