export async function onRequestGet(context) {
  const REPO = "doctorstrange1122/huafei";
  const HTML_PATH = "super/index.html";
  const CSV_PATH = "data/links.csv";
  const TKTOOL_LIST = "https://tktool.pages.dev/api/huafei-list";

  let htmlText = "";
  let csvText = "";
  let srcNote = "";

  // HTML（自动列来源）：raw 优先，jsDelivr 兜底，均 no-store
  htmlText = await fetchText(`https://raw.githubusercontent.com/${REPO}/main/${HTML_PATH}`, `https://cdn.jsdelivr.net/gh/${REPO}@main/${HTML_PATH}`);
  // CSV（手动层：第10列原链接 + 手动记录行）
  csvText = await fetchText(`https://raw.githubusercontent.com/${REPO}/main/${CSV_PATH}`, `https://cdn.jsdelivr.net/gh/${REPO}@main/${CSV_PATH}`);
  if (csvText) srcNote = "raw/jsdelivr";

  // tktool 自定义链接（软件“自定义链接输入框”保存的 hfself:*），直接拉取合并到“自定义”区
  const tktoolRows = [];
  let tktoolNote = "";
  try {
    const r = await fetch(TKTOOL_LIST, { cache: "no-store", headers: { "User-Agent": "huafei-links/1.0" } });
    if (r.ok) {
      const data = await r.json();
      const items = (data && Array.isArray(data.items)) ? data.items : [];
      for (const it of items) {
        const url = it.url || "";
        if (!url) continue;
        const key = String(it.key || "").replace(/^hfself:/, "") || "自定义链接";
        const did = (url.match(/deliveryId=(\d+)/) || [])[1] || "";
        const sid = (url.match(/sceneId=(\d+)/) || [])[1] || "";
        // 不去重：每一条都保留，直接并入“自定义”区
        tktoolRows.push(["自定义", "", key, "", did, sid, "是", "", url, ""]);
      }
      tktoolNote = `tktool ${items.length} 条`;
    }
  } catch (e) {}

  const html = buildHtml(htmlText, csvText, srcNote, tktoolRows, tktoolNote);
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

// 去掉标题中括号里的提示内容：如 "百补区(默认每日1次)" -> "百补区"
function stripParen(s) {
  return (s || "").replace(/[（(][^（）()]*[)）]/g, "").trim();
}

// 从按钮块中提取状态：status-badge testing -> 待测，status-badge available -> 可用
function statusInBlock(block) {
  if (/status-badge\s+testing/.test(block)) return "待测";
  if (/status-badge\s+available/.test(block)) return "可用";
  return "";
}

// 按文档顺序遍历，同时跟踪 一级标题(level2-title) 与 二级标题(level3-title)
function parseHtmlButtons(html) {
  const tokens = [];
  for (const m of html.matchAll(/<div class="level2-title">([^<]+)<\/div>/g))
    tokens.push({ pos: m.index, type: "l2", text: m[1].trim() });
  for (const m of html.matchAll(/<div class="btn-section-title level3-title">([^<]+)<\/div>/g))
    tokens.push({ pos: m.index, type: "l3", text: m[1].trim() });
  for (const m of html.matchAll(/generateQRCodes\(\s*(\d+)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g))
    tokens.push({ pos: m.index, type: "gq", count: m[1], url: m[2], label: m[3], key: m[4] });
  for (const m of html.matchAll(/<button\b([^>]*)>/g)) {
    const tag = m[1];
    const keyM = tag.match(/data-btn-key="([^"]+)"/);
    if (keyM && keyM[1].startsWith("entrance_")) tokens.push({ pos: m.index, type: "ent", tag });
  }
  tokens.sort((a, b) => a.pos - b.pos);

  const rows = [];
  let curL2 = null, curL3 = null;
  for (const t of tokens) {
    if (t.type === "l2") { curL2 = t.text; curL3 = null; }
    else if (t.type === "l3") { curL3 = t.text; }
    else if (t.type === "gq") {
      const key = t.key;
      if (key.includes("+") || key.includes("'")) continue; // 跳过动态模板按钮
      const did = (t.url.match(/deliveryId=(\d+)/) || [])[1] || "";
      const sid = (t.url.match(/sceneId=(\d+)/) || [])[1] || "";
      const level1 = key.startsWith("self_") ? "自定义" : stripParen(curL2 || "?");
      const subtitle = key.startsWith("self_") ? "" : (curL3 ? stripParen(curL3) : "");
      // 状态：取该按钮块内的 status-badge
      const bStart = html.lastIndexOf("<button", t.pos);
      const bEnd = html.indexOf("</button>", t.pos);
      const block = (bStart >= 0 && bEnd >= 0) ? html.slice(bStart, bEnd) : "";
      const status = statusInBlock(block);
      rows.push({ level1, subtitle, name: t.label, daily: t.count, did, sid, status, link: t.url });
    }
    else if (t.type === "ent") {
      const tag = t.tag;
      const keyM = tag.match(/data-btn-key="([^"]+)"/);
      const key = keyM[1];
      const oc = tag.match(/openTaobaoApp\(\s*'([^']*)'/);
      const url = oc ? oc[1] : "";
      const end = html.indexOf("</button>", t.pos);
      const inner = html.slice(t.pos, end);
      const lbl = (inner.match(/btn-label">([^<]+)</) || [])[1] || key;
      const did = (url.match(/deliveryId=(\d+)/) || [])[1] || "";
      const sid = (url.match(/sceneId=(\d+)/) || [])[1] || "";
      const level1 = stripParen(curL2 || "入口区");
      const subtitle = curL3 ? stripParen(curL3) : "";
      const status = statusInBlock(inner);
      rows.push({ level1, subtitle, name: lbl, daily: "", did, sid, status, link: url });
    }
  }
  return rows;
}

// 列顺序（10 列）：一级标题,二级标题,奖励名,每日次数,deliveryId,sceneId,是否使用,状态,链接,原链接
function reconcile(htmlText, csvText) {
  const autoRows = parseHtmlButtons(htmlText);
  const autoDids = new Set(autoRows.map(r => r.did).filter(Boolean));
  // 原链接按 deliveryId 索引；同 did 多行时再用链接 path（去掉动态 query）精确匹配合并行
  const csvByDid = {};
  const manualCand = [];
  if (csvText && csvText.trim()) {
    for (const row of parseCSV(csvText)) {
      if (row.length < 10) continue;
      const did = row[4];
      if (did && autoDids.has(did)) {
        (csvByDid[did] = csvByDid[did] || []).push(row);
      } else {
        // 未命中 HTML：候选手动记录行（按 一级标题+奖励名 后续合并或保留）
        manualCand.push(row);
      }
    }
  }
  const pathOf = u => (u || "").split("?")[0];
  const filled = autoRows.map(a => {
    let orig = "";
    const cands = csvByDid[a.did] || [];
    if (cands.length) {
      let pick = cands.find(r => r[9] && pathOf(r[8]) === pathOf(a.link));
      if (!pick) pick = cands.find(r => r[9]);
      if (pick) orig = pick[9];
    }
    return [a.level1, a.subtitle, a.name, a.daily, a.did, a.sid, "是", a.status, a.link, orig];
  });
  // 手动候选与自动行按 (一级标题|奖励名)+path 合并（回填原链接，去重）；无法匹配则保留为独立手动记录行
  const manualRows = [];
  for (const row of manualCand) {
    const l1 = row[0], name = row[2];
    let target = filled.find(r => r[0] === l1 && r[2] === name && pathOf(r[8]) === pathOf(row[8]));
    if (!target) target = filled.find(r => r[0] === l1 && r[2] === name);
    if (target && !target[9]) target[9] = row[9];
    if (!target) manualRows.push(row);
  }
  // 手动记录行置顶（用户要求汇总到表格最上方）
  return [...manualRows, ...filled];
}

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function classForLevel1(level1) {
  const map = { "手动记录": "manual", "秒杀区": "ms", "百补区": "bb", "入口区": "rukou", "自定义": "zdy" };
  return "cat-" + (map[level1] || "other");
}

function buildHtml(htmlText, csvText, srcNote, extraRows, extraNote) {
  let errMsg = "";
  let finalRows = [];
  if (htmlText && htmlText.trim()) {
    try { finalRows = reconcile(htmlText, csvText); }
    catch (e) { errMsg = "解析失败：" + e.message; }
  } else {
    errMsg = "HTML 加载失败，请确认仓库 super/index.html 是否存在";
  }
  // 追加 tktool 自定义链接（不去重，全部保留）
  if (Array.isArray(extraRows) && extraRows.length) finalRows = finalRows.concat(extraRows);

  // 每列去重值，用于表头筛选下拉
  const COLS = ["一级标题","二级标题","奖励名","每日次数","deliveryId","sceneId","是否使用","状态","链接","原链接"];
  const LONG_COLS = new Set([8, 9]); // 链接/原链接：选项文本截断，value 仍用完整值
  const colValues = COLS.map((_, c) => {
    const set = new Set();
    for (const r of finalRows) { const v = String(r[c] || "").trim(); if (v) set.add(v); }
    return [...set].sort((a, b) => a.localeCompare(b, "zh"));
  });
  const theadCells = COLS.map((name, c) => {
    const opts = ['<option value="">全部</option>'].concat(
      colValues[c].map(v => `<option value="${esc(v)}">${esc(LONG_COLS.has(c) && v.length > 30 ? v.slice(0, 30) + "…" : v)}</option>`)
    ).join("");
    return `<th><div class="th-name">${esc(name)}</div><select class="col-filter" data-col="${c}">${opts}</select></th>`;
  }).join("");

  const counts = { "手动记录": 0, "秒杀区": 0, "百补区": 0, "入口区": 0, "自定义": 0 };
  const bodyRows = finalRows.map(r => {
    const [level1, subtitle, name, daily, did, sid, used, status, link, orig] = r;
    const catCls = classForLevel1(level1);
    const usedCls = used === "是" ? "yes" : "no";
    const rowCls = used === "否" ? "unused" : "";
    const statusCls = status === "待测" ? "st-testing" : (status === "可用" ? "st-available" : "st-none");
    const linkHtml = link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a>` : "";
    const origHtml = orig ? `<a href="${esc(orig)}" target="_blank" rel="noopener">${esc(orig)}</a>` : "";
    if (counts.hasOwnProperty(level1)) counts[level1]++;
    return `<tr class="${rowCls} ${catCls}">
      <td class="${catCls}">${esc(level1)}</td>
      <td>${esc(subtitle)}</td>
      <td>${esc(name)}</td>
      <td>${esc(daily)}</td>
      <td>${esc(did)}</td>
      <td>${esc(sid)}</td>
      <td class="${usedCls}">${esc(used)}</td>
      <td class="status ${statusCls}">${esc(status)}</td>
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
    : `共 ${finalRows.length} 条 · ${countParts} · 数据源 ${srcNote || "未知"}${extraNote ? " · " + extraNote : ""} · 更新时间 ${new Date().toLocaleString("zh-CN")}`;

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
  table { border-collapse:collapse; width:100%; min-width:1220px; font-size:13px; margin:0 auto; }
  th,td { padding:9px 12px; text-align:center; border-bottom:1px solid #eee; white-space:nowrap; }
  th { background:#f0f2f5; font-weight:600; position:sticky; top:0; }
  tbody tr:hover { background:#fafbfc; }
  tbody tr.unused { background:#e9eef3; }
  tbody tr.unused:hover { background:#e1e8ee; }
  /* 一级标题整行背景：低饱和度、低亮度（暗淡莫兰迪色） */
  tbody tr.cat-manual { background:hsl(210,8%,38%);  color:#ececec; }
  tbody tr.cat-ms     { background:hsl(2,32%,42%);   color:#f3f3f3; }
  tbody tr.cat-bb     { background:hsl(26,30%,40%);  color:#f4f4f4; }
  tbody tr.cat-rukou  { background:hsl(205,32%,42%); color:#f3f3f3; }
  tbody tr.cat-zdy    { background:hsl(265,26%,42%); color:#f3f3f3; }
  tbody tr.cat-other  { background:hsl(190,14%,40%); color:#f3f3f3; }
  tbody tr.cat-manual:hover { background:hsl(210,8%,44%); }
  tbody tr.cat-ms:hover     { background:hsl(2,32%,47%); }
  tbody tr.cat-bb:hover     { background:hsl(26,30%,45%); }
  tbody tr.cat-rukou:hover  { background:hsl(205,32%,47%); }
  tbody tr.cat-zdy:hover    { background:hsl(265,26%,47%); }
  tbody tr.cat-other:hover  { background:hsl(190,14%,45%); }
  .yes { color:#7ee2a8; font-weight:600; }
  .no { color:#ff9b9b; font-weight:600; }
  /* 状态列徽标 */
  td.status { font-weight:700; }
  td.status.st-testing { color:#ffce85; }
  td.status.st-available { color:#8fe3b0; }
  td.status.st-none { color:#cfcfcf; }
  td.link a { color:#9ecbff; text-decoration:none; max-width:260px; overflow:hidden; text-overflow:ellipsis; display:inline-block; vertical-align:bottom; }
  td.link a:hover { text-decoration:underline; }
  .err { color:#c0392b; }
  /* 表头筛选下拉 */
  th .th-name { font-weight:600; margin-bottom:4px; line-height:1.2; }
  th select.col-filter { display:block; width:100%; max-width:150px; margin:2px auto 0; font-size:12px; padding:3px 4px; border-radius:5px; border:1px solid #c7ccd1; background:#fff; color:#222; box-sizing:border-box; }
  .filter-info { color:#666; font-size:13px; margin-bottom:10px; min-height:18px; }
  @media (prefers-color-scheme:dark){
    body{background:#15171a;color:#e6e6e6;}
    th select.col-filter{background:#2a2e34;color:#e6e6e6;border-color:#3a3f47;}
    .filter-info{color:#aaa;}
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
    td.status.st-testing{color:#ffd479;}
    td.status.st-available{color:#7ee2a8;}
  }
</style>
</head>
<body>
  <h1>链接数据表</h1>
  <div class="meta">${meta}</div>
  <div class="filter-info" id="metaCount"></div>
  <div class="table-wrap">
    <table id="dataTable">
      <thead><tr>${theadCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </div>
  <script>
  (function(){
    var table = document.getElementById('dataTable');
    if (!table) return;
    var selects = Array.prototype.slice.call(document.querySelectorAll('.col-filter'));
    function apply(){
      var crit = selects.map(function(s){ return s.value; });
      var rows = table.tBodies[0].rows;
      var shown = 0;
      for (var i=0;i<rows.length;i++){
        var tds = rows[i].children;
        var ok = true;
        for (var c=0;c<crit.length;c++){
          if (crit[c] && (tds[c].textContent||'').trim() !== crit[c]) { ok=false; break; }
        }
        rows[i].style.display = ok ? '' : 'none';
        if (ok) shown++;
      }
      var el = document.getElementById('metaCount');
      if (el) el.textContent = '筛选后显示 ' + shown + ' / ' + rows.length + ' 条';
    }
    selects.forEach(function(s){ s.addEventListener('change', apply); });
  })();
  </script>
</body>
</html>`;
}
