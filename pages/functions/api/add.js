// env-check v2: ensure new env vars are picked up after redeploy
const REPO = "doctorstrange1122/huafei";
const PATH = "data/links.csv";
const BRANCH = "main";
// 列顺序必须与 links.js 的 reconcile 解析保持一致（10 列）
const FIELDS = ["level1", "subtitle", "name", "daily", "did", "sid", "used", "status", "link", "orig"];

function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
function b64decode(b64) { return decodeURIComponent(escape(atob(b64))); }
function csvEscape(s) { return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

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

  const ghHeaders = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "huafei-add" };
  const getUrl = `https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${BRANCH}`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const g = await fetch(getUrl, { headers: ghHeaders });
    if (!g.ok) return new Response(JSON.stringify({ ok: false, error: `读取 CSV 失败: ${g.status}` }), { status: 502, headers });
    const gj = await g.json();
    let content = b64decode(gj.content);
    content = content.length ? content.replace(/\n+$/, "\n") + newLine + "\n" : newLine + "\n";
    const putBody = JSON.stringify({
      message: `add row via web form: ${body.name || ""}`,
      content: b64encode(content),
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
        note: "已写入 data/links.csv。线上 /links 表格会实时（或等待 CDN 缓存刷新后）反映新行，通常无需重新部署。"
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
