// 列顺序与 links.js / delete.js 保持一致（10 列）
// 一级标题,二级标题,奖励名,sceneId,deliveryId,每日次数,是否使用,状态,链接,原链接
const REPO = "doctorstrange1122/huafei";
const PATH = "data/links.csv";
const BRANCH = "main";
const FIELDS = ["level1", "subtitle", "name", "sid", "did", "daily", "used", "status", "link", "orig"];
// 索引：0 level1, 1 subtitle, 2 name, 3 sid, 4 did, 5 daily, 6 used, 7 status, 8 link, 9 orig

function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64decode(b64) { return decodeURIComponent(escape(atob(b64))); }
function csvEscape(s) { return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function splitLine(line) {
  return line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
}
function unquote(s) {
  const t = String(s || "").trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
}
function numKey(s) {
  const n = parseInt(unquote(s), 10);
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}
// 「手动记录的参数行」= 一级标题为手动记录、且链接与原链接都为空的纯参数行
function isParamRow(c) {
  return c.length === 10 && unquote(c[0]) === "手动记录" && unquote(c[8]) === "" && unquote(c[9]) === "";
}
function paramKey(c) {
  return unquote(c[3]) + "/" + unquote(c[4]); // sceneId / deliveryId
}
function isManual(c) {
  return c.length === 10 && unquote(c[0]) === "手动记录";
}

// 去重 + 排序，返回 { text, merged }
function rebuild(content, newLine, doDedupe) {
  const lines = content.replace(/\r/g, "").split("\n").filter(l => l.trim().length);
  if (!lines.length) return { text: newLine + "\n", merged: 0 };
  const header = lines[0];
  const rows = lines.slice(1).map(splitLine);
  const newCells = splitLine(newLine);
  let kept = rows.slice();
  let merged = 0;

  if (doDedupe) {
    // 1) 全表：纯参数行按 (sceneId, deliveryId) 只保留第一条，其余删除
    const seen = new Set();
    const stage = [];
    for (const c of kept) {
      if (isParamRow(c)) {
        const k = paramKey(c);
        if (seen.has(k)) { merged++; continue; }
        seen.add(k);
      }
      stage.push(c);
    }
    kept = stage;
    // 2) 本次录入若与已有参数行同 key，删除旧行，以本次录入为准
    if (isParamRow(newCells)) {
      const nk = paramKey(newCells);
      const before = kept.length;
      kept = kept.filter(c => !(isParamRow(c) && paramKey(c) === nk));
      merged += before - kept.length;
    }
  }

  kept.push(newCells);
  // 3) 手动记录行按 sceneId → deliveryId 排序并集中到末尾；其余行保持原顺序
  const manual = kept.filter(isManual);
  const other = kept.filter(c => !isManual(c));
  manual.sort((a, b) => numKey(a[3]) - numKey(b[3]) || numKey(a[4]) - numKey(b[4]));
  const out = [header].concat(other, manual)
    .map(c => Array.isArray(c) ? c.join(",") : c).join("\n");
  return { text: out + "\n", merged };
}

export async function onRequestPost({ request, env }) {
  const headers = { "content-type": "application/json", "Access-Control-Allow-Origin": "*" };
  const token = env.GITHUB_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({
      ok: false,
      error: "服务器未配置 GITHUB_TOKEN。若已添加，请在 Cloudflare 后台重新部署 Pages；未配置请在项目 Settings → Environment variables 中添加 GITHUB_TOKEN（值 = 具有该仓库写权限的 GitHub PAT），保存后等待自动重部署。"
    }), { status: 500, headers });
  }
  // 可选二次鉴权：若配置了 ADD_KEY，则请求头必须带 x-add-key
  const addKey = env.ADD_KEY;
  if (addKey) {
    const h = request.headers.get("x-add-key") || "";
    if (h !== addKey) return new Response(JSON.stringify({ ok: false, error: "密钥错误" }), { status: 401, headers });
  }
  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ ok: false, error: "请求体不是合法 JSON" }), { status: 400, headers }); }

  const row = FIELDS.map(f => csvEscape(String(body[f] ?? "")));
  if (!row[2].trim()) return new Response(JSON.stringify({ ok: false, error: "奖励名不能为空" }), { status: 400, headers });
  const newLine = row.join(",");
  const doDedupe = body.dedupe !== false; // 默认开启，可由前端开关关闭

  const ghHeaders = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "huafei-add" };
  const getUrl = `https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const g = await fetch(getUrl, { headers: ghHeaders });
    if (!g.ok) return new Response(JSON.stringify({ ok: false, error: `读取 CSV 失败: ${g.status}` }), { status: 502, headers });
    const gj = await g.json();
    const built = rebuild(b64decode(gj.content), newLine, doDedupe);
    const putBody = JSON.stringify({
      message: `add row via web form: ${body.name || ""}${built.merged ? " (merged " + built.merged + ")" : ""}`,
      content: b64encode(built.text),
      sha: gj.sha,
      branch: BRANCH
    });
    const p = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}`, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: putBody
    });
    if (p.ok) {
      return new Response(JSON.stringify({
        ok: true,
        merged: built.merged,
        note: `已写入 data/links.csv${built.merged ? "，并自动合并/删除 " + built.merged + " 条相同参数的手动记录" : ""}。手动记录行已按 sceneId → deliveryId 排序，线上 /links 表格会实时（或等待 CDN 缓存刷新后）反映。`
      }), { headers });
    }
    if (p.status !== 409) {
      const pe = await p.text();
      return new Response(JSON.stringify({ ok: false, error: `写入失败: ${p.status} ${pe.slice(0, 200)}` }), { status: 502, headers });
    }
    // 409 冲突：CSV 被并发修改，重新拉取再写
  }
  return new Response(JSON.stringify({ ok: false, error: "并发冲突，重试失败，请稍后重试" }), { status: 409, headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-add-key"
    }
  });
}
