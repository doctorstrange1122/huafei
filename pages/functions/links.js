export async function onRequestGet(context) {
  const SOURCES = [
    "https://cdn.jsdelivr.net/gh/doctorstrange1122/huafei@main/data/links.csv",
    "https://raw.githubusercontent.com/doctorstrange1122/huafei/main/data/links.csv"
  ];

  let csvText = "";
  for (const url of SOURCES) {
    try {
      const res = await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } });
      if (res.ok) { csvText = await res.text(); if (csvText.trim()) break; }
    } catch (e) { /* try next */ }
  }

  const html = buildHtml(csvText);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function parseCSV(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim().length);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    rows.push(cells.map(c => c.replace(/^"|"$/g, "").trim()));
  }
  return rows;
}

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtml(csvText) {
  let rows = [];
  let errMsg = "";
  if (csvText && csvText.trim()) {
    try { rows = parseCSV(csvText); } catch (e) { errMsg = "CSV 解析失败"; }
  } else {
    errMsg = "数据加载失败，请确认仓库 data/links.csv 是否存在";
  }

  let feiliao = 0, qita = 0;
  const bodyRows = rows.map(r => {
    const [cat, name, daily, did, sid, used, link] = r;
    const catCls = cat === "肥料" ? "cat-feiliao" : "cat-qita";
    const usedCls = used === "是" ? "yes" : "no";
    const rowCls = used === "否" ? "unused" : "";
    const linkHtml = link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : "";
    if (cat === "肥料") feiliao++; else qita++;
    return `<tr class="${rowCls}">
      <td class="${catCls}">${esc(cat)}</td>
      <td>${esc(name)}</td>
      <td>${esc(daily)}</td>
      <td>${esc(did)}</td>
      <td>${esc(sid)}</td>
      <td class="${usedCls}">${esc(used)}</td>
      <td class="link">${linkHtml}</td>
    </tr>`;
  }).join("");

  const meta = errMsg
    ? `<span class="err">${errMsg}</span>`
    : `共 ${rows.length} 条 · 肥料区 ${feiliao} · 其他区 ${qita} · 更新时间 ${new Date().toLocaleString("zh-CN")}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>链接数据表</title>
<style>
  * { box-sizing: border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; margin:0; padding:20px 16px; color:#222; background:#f5f6f8; }
  h1 { font-size:20px; margin:0 0 4px; }
  .meta { color:#888; font-size:13px; margin-bottom:16px; }
  .table-wrap { overflow-x:auto; background:#fff; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.08); }
  table { border-collapse:collapse; width:100%; min-width:760px; font-size:13px; margin:0 auto; }
  th,td { padding:9px 12px; text-align:center; border-bottom:1px solid #eee; white-space:nowrap; }
  th { background:#f0f2f5; font-weight:600; position:sticky; top:0; }
  tbody tr:hover { background:#fafbfc; }
  tbody tr.unused { background:#e9eef3; }
  tbody tr.unused:hover { background:#e1e8ee; }
  .cat-feiliao { color:#c8842a; }
  .cat-qita { color:#3a7ca5; }
  .yes { color:#2e8b57; font-weight:600; }
  .no { color:#c0392b; font-weight:600; }
  td.link a { color:#2b6cb0; text-decoration:none; max-width:260px; overflow:hidden; text-overflow:ellipsis; display:inline-block; vertical-align:bottom; }
  td.link a:hover { text-decoration:underline; }
  .err { color:#c0392b; }
  @media (prefers-color-scheme:dark){
    body{background:#15171a;color:#e6e6e6;}
    .table-wrap{background:#1e2125;box-shadow:none;}
    th{background:#262a2f;}
    th,td{border-bottom-color:#2c2f34;}
    tbody tr:hover{background:#23272c;}
    tbody tr.unused{background:#222831;}
    tbody tr.unused:hover{background:#262c36;}
  }
</style>
</head>
<body>
  <h1>链接数据表</h1>
  <div class="meta">${meta}</div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>奖励</th><th>奖励名</th><th>每日次数</th><th>deliveryId</th><th>sceneId</th><th>是否使用</th><th>链接</th></tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </div>
</body>
</html>`;
}
