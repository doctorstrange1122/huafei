export async function onRequestGet(context) {
  const REPO = "doctorstrange1122/huafei";
  const HTML_PATH = "super/index.html";
  const CSV_PATH = "data/links.csv";

  let htmlText = "";
  let csvText = "";
  let srcNote = "";

  // HTML（自动列来源）：raw 优先，jsDelivr 兜底，均 no-store
  htmlText = await fetchText(`https://raw.githubusercontent.com/${REPO}/main/${HTML_PATH}`, `https://cdn.jsdelivr.net/gh/${REPO}@main/${HTML_PATH}`);
  // CSV（手动层：第9列原链接 + 手动记录行）
  csvText = await fetchText(`https://raw.githubusercontent.com/${REPO}/main/${CSV_PATH}`, `https://cdn.jsdelivr.net/gh/${REPO}@main/${CSV_PATH}`);
  if (csvText) srcNote = "raw/jsdelivr";

  const html = buildHtml(htmlText, csvText, srcNote);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function fetchText(rawUrl, jsdelivrUrl) {
  try {
    const r = await fetch(rawUrl, { cache: "no-store" });
    if (r.ok) return await r.text();
  } catch (e) {}
  try {
    const r = await fetch(jsdelivrUrl, { cache: "no-store" });
    if (r.ok) return await r.text();
  } catch (e) {}
  return "";
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

const SECTION_SHORT = {
  "秒杀区": "秒杀区",
  "百补区(默认每日1次)": "百补区",
  "入口区(不替换id，使用默认链接)": "入口区"
};

function parseHtmlButtons(html) {
  const rows = [];
  const titleIter = [...html.matchAll(/<div class="level2-title">([^<]+)<\/div>/g)];
  function sectionOf(pos) {
    let sec = "?";
    for (const t of titleIter) {
      if (t.index <= pos) sec = t[1].trim();
      else break;
    }
    return SECTION_SHORT[sec] || sec;
  }
  // 1) 普通 / self_ 按钮：generateQRCodes(count, 'url', 'label', 'key')
  const gq = /generateQRCodes\(\s*(\d+)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g;
  let m;
  while ((m = gq.exec(html)) !== null) {
    const count = m[1], url = m[2], label = m[3], key = m[4];
    if (key.includes("+") || key.includes("'")) continue; // 跳过动态模板按钮
    const did = (url.match(/deliveryId=(\d+)/) || [])[1] || "";
    const sid = (url.match(/sceneId=(\d+)/) || [])[1] || "";
    const level1 = key.startsWith("self_") ? "自定义" : sectionOf(m.index);
    rows.push({ level1, name: label, daily: count, did, sid, link: url });
  }
  // 2) 入口区固定按钮：<button ... openTaobaoApp('url', 'key') data-btn-key="entrance_...">...<span class="btn-label">LABEL</span>
  const btnRe = /<button\b([^>]*)>/g;
  while ((m = btnRe.exec(html)) !== null) {
    const tag = m[1];
    const keyM = tag.match(/data-btn-key="([^"]+)"/);
    if (!keyM || !keyM[1].startsWith("entrance_")) continue;
    const oc = tag.match(/openTaobaoApp\(\s*'([^']*)'/);
    const url = oc ? oc[1] : "";
    const end = html.indexOf("</button>", m.index);
    const inner = html.slice(m.index, end);
    const lbl = (inner.match(/btn-label">([^<]+)</) || [])[1] || keyM[1];
    const did = (url.match(/deliveryId=(\d+)/) || [])[1] || "";
    const sid = (url.match(/sceneId=(\d+)/) || [])[1] || "";
    rows.push({ level1: "入口区", name: lbl, daily: "", did, sid, link: url });
  }
  return rows;
}

function reconcile(htmlText, csvText) {
  const autoRows = parseHtmlButtons(htmlText);
  const autoDids = new Set(autoRows.map(r => r.did).filter(Boolean));
  const rewardByDid = {};
  const origByDid = {};
  const manualRows = [];
  if (csvText && csvText.trim()) {
    const csvRows = parseCSV(csvText);
    for (const row of csvRows) {
      if (row.length < 9) continue;
      const [l1, reward, name, daily, did, sid, used, link, orig] = row;
      if (did && autoDids.has(did)) {
        // 命中 HTML：转为自动行，仅取 奖励(第2列) 与 原链接(第9列)
        if (reward) rewardByDid[did] = reward;
        if (orig) origByDid[did] = orig;
      } else {
        // 未命中：保留为手动记录行
        manualRows.push(row);
      }
    }
  }
  const finalRows = autoRows.map(a => [
    a.level1, rewardByDid[a.did] || "", a.name, a.daily, a.did, a.sid, "是", a.link, origByDid[a.did] || ""
  ]);
  for (const r of manualRows) finalRows.push(r);
  return finalRows;
}

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function classForLevel1(level1) {
  const map = { "手动记录": "manual", "秒杀区": "ms", "百补区": "bb", "入口区": "rukou", "自定义": "zdy" };
  return "cat-" + (map[level1] || "other");
}

function buildHtml(htmlText, csvText, srcNote) {
  let errMsg = "";
  let finalRows = [];
  if (htmlText && htmlText.trim()) {
    try { finalRows = reconcile(htmlText, csvText); }
    catch (e) { errMsg = "解析失败：" + e.message; }
  } else {
    errMsg = "HTML 加载失败，请确认仓库 super/index.html 是否存在";
  }

  const counts = { "手动记录": 0, "秒杀区": 0, "百补区": 0, "入口区": 0, "自定义": 0 };
  const bodyRows = finalRows.map(r => {
    const [level1, reward, name, daily, did, sid, used, link, orig] = r;
    const catCls = classForLevel1(level1);
    const usedCls = used === "是" ? "yes" : "no";
    const rowCls = used === "否" ? "unused" : "";
    const linkHtml = link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : "";
    const origHtml = orig ? `<a href="${esc(orig)}" target="_blank" rel="noopener">${esc(orig)}</a>` : "";
    if (counts.hasOwnProperty(level1)) counts[level1]++;
    return `<tr class="${rowCls}">
      <td class="${catCls}">${esc(level1)}</td>
      <td>${esc(reward)}</td>
      <td>${esc(name)}</td>
      <td>${esc(daily)}</td>
      <td>${esc(did)}</td>
      <td>${esc(sid)}</td>
      <td class="${usedCls}">${esc(used)}</td>
      <td class="link">${linkHtml}</td>
      <td class="link">${origHtml}</td>
    </tr>`;
  }).join("");

  const countParts = Object.entries(counts)
    .filter(([k, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");

  const meta = errMsg
    ? `<span class="err">${errMsg}</span>`
    : `共 ${finalRows.length} 条 · ${countParts} · 数据源 ${srcNote || "未知"} · 更新时间 ${new Date().toLocaleString("zh-CN")}`;

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
  table { border-collapse:collapse; width:100%; min-width:1100px; font-size:13px; margin:0 auto; }
  th,td { padding:9px 12px; text-align:center; border-bottom:1px solid #eee; white-space:nowrap; }
  th { background:#f0f2f5; font-weight:600; position:sticky; top:0; }
  tbody tr:hover { background:#fafbfc; }
  tbody tr.unused { background:#e9eef3; }
  tbody tr.unused:hover { background:#e1e8ee; }
  .cat-manual { color:#888; }
  .cat-ms { color:#c0392b; }
  .cat-bb { color:#e67e22; }
  .cat-rukou { color:#3a7ca5; }
  .cat-zdy { color:#8e44ad; }
  .cat-other { color:#2c3e50; }
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
    .cat-ms{color:#ff6b6b;}
    .cat-bb{color:#f6b93b;}
    .cat-rukou{color:#74b9ff;}
    .cat-zdy{color:#a29bfe;}
    td.link a{color:#63b3ed;}
  }
</style>
</head>
<body>
  <h1>链接数据表</h1>
  <div class="meta">${meta}</div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>一级标题</th><th>奖励</th><th>奖励名</th><th>每日次数</th><th>deliveryId</th><th>sceneId</th><th>是否使用</th><th>链接</th><th>原链接</th></tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </div>
</body>
</html>`;
}
