// 删除 data/links.csv 中的手动记录/自定义行
// GET  -> 返回当前可删除的行列表（一级标题为 手动记录/自定义）
// POST -> 按整行 10 列精确匹配删除，GitHub 409 并发冲突自动重试
const REPO = "doctorstrange1122/huafei";
const PATH = "data/links.csv";
const BRANCH = "main";
// 列顺序必须与 add.js / links.js 保持一致（10 列）
const FIELDS = ["level1", "subtitle", "name", "daily", "did", "sid", "used", "status", "link", "orig"];
// 仅这两类行允许通过网页删除；秒杀区/百补区/入口区为 HTML 按钮自动行，删了也会被 reconcile 恢复
const DELETABLE = new Set(["手动记录", "自定义"]);

function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64decode(b64) { return decodeURIComponent(escape(atob(b64))); }
function csvEscape(s) { return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function splitCsvLine(line) {
  return line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, "").trim());
}
const jsonHeaders = () => ({ "content-type": "application/json", "Access-Control-Allow-Origin": "*" });

function authFail(request, env) {
  const addKey = env.ADD_KEY;
  if (addKey && (request.headers.get("x-add-key") || "") !== addKey) return true;
  return false;
}

export async function onRequestGet({ request, env }) {
  const headers = jsonHeaders();
  if (authFail(request, env)) {
    return new Response(JSON.stringify({ ok: false, error: "密钥错误" }), { status: 401, headers });
  }
  if (!env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: "服务器未配置 GITHUB_TOKEN，请联系管理员在 Cloudflare 后台添加。" }), { status: 500, headers });
  }
  const ghHeaders = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "huafei-delete" };
  const g = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`, { headers: ghHeaders });
  if (!g.ok) {
    return new Response(JSON.stringify({ ok: false, error: `读取 CSV 失败: ${g.status}` }), { status: 502, headers });
  }
  const gj = await g.json();
  const text = b64decode(gj.content);
  const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim().length);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length !== 10) continue; // 列数异常（如粘连行）：跳过，避免误判
    if (!DELETABLE.has(cells[0])) continue; // 只列出可删除的行
    const row = {};
    FIELDS.forEach((f, ci) => { row[f] = cells[ci] || ""; });
    rows.push(row);
  }
  return new Response(JSON.stringify({ ok: true, total: rows.length, rows }), {
    headers: { ...headers, "Cache-Control": "no-store" }
  });
}

export async function onRequestPost({ request, env }) {
  const headers = jsonHeaders();
  if (authFail(request, env)) {
    return new Response(JSON.stringify({ ok: false, error: "密钥错误" }), { status: 401, headers });
  }
  if (!env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({
      ok: false,
      error: "服务器未配置 GITHUB_TOKEN。请在 Cloudflare 后台 Settings → Environment variables 中添加 GITHUB_TOKEN（值 = 具有该仓库写权限的 GitHub PAT），保存后等待自动重部署。"
    }), { status: 500, headers });
  }
  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: "请求体不是合法 JSON" }), { status: 400, headers });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return new Response(JSON.stringify({ ok: false, error: "请求体必须是 JSON 对象" }), { status: 400, headers });
  }

  // 目标行：10 列全部参与精确匹配，避免误删
  const target = {};
  for (const f of FIELDS) target[f] = String(body[f] ?? "").trim();
  if (!target.name) {
    return new Response(JSON.stringify({ ok: false, error: "奖励名不能为空" }), { status: 400, headers });
  }
  if (!DELETABLE.has(target.level1)) {
    return new Response(JSON.stringify({ ok: false, error: `仅允许删除「手动记录」「自定义」行，收到：${target.level1 || "(空)"}` }), { status: 400, headers });
  }

  const ghHeaders = { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "huafei-delete" };
  const getUrl = `https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const g = await fetch(getUrl, { headers: ghHeaders });
    if (!g.ok) {
      return new Response(JSON.stringify({ ok: false, error: `读取 CSV 失败: ${g.status}` }), { status: 502, headers });
    }
    const gj = await g.json();
    const text = b64decode(gj.content);
    const rawLines = text.replace(/\r/g, "").split("\n");
    const kept = [];
    let deleted = 0;
    let headerDone = false;
    for (const line of rawLines) {
      if (!line.trim()) { kept.push(line); continue; }
      if (!headerDone) { headerDone = true; kept.push(line); continue; } // 表头不动
      const cells = splitCsvLine(line);
      if (cells.length !== 10) { kept.push(line); continue; } // 列数异常：原样保留
      const row = {};
      FIELDS.forEach((f, ci) => { row[f] = (cells[ci] ?? "").trim(); });
      if (deleted === 0 && FIELDS.every(f => row[f] === target[f])) { deleted++; continue; } // 命中：仅删第一条（重复行逐条删）
      kept.push(line);
    }
    if (!deleted) {
      return new Response(JSON.stringify({ ok: false, error: "未找到匹配的行（可能已被删除或内容有变化，请刷新列表后重试）" }), { status: 404, headers });
    }
    let out = kept.join("\n");
    if (!out.endsWith("\n")) out += "\n";
    const putBody = JSON.stringify({
      message: `delete row via web form: ${target.name} (${target.level1})`,
      content: b64encode(out),
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
        note: `已删除 ${deleted} 行：${target.name}。线上 /links 会实时（或等待 CDN 缓存刷新后）更新。`
      }), { headers });
    }
    if (p.status !== 409) {
      const pe = await p.text();
      return new Response(JSON.stringify({ ok: false, error: `写入失败: ${p.status} ${pe.slice(0, 200)}` }), { status: 502, headers });
    }
    // 409 冲突：CSV 被并发修改，重新拉取再删
  }
  return new Response(JSON.stringify({ ok: false, error: "并发冲突，重试失败，请稍后重试" }), { status: 409, headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-add-key"
    }
  });
}
