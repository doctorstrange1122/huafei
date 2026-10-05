// 把自定义链接写入 super/index.html 的按钮表（每链接一个随机 key，保留最近 20 条）
// 入参：{ url: 'https://pages-fast.m.taobao.com/...', key: 'self_xxxx' }
// 前置：Cloudflare Pages 环境变量需配置 GITHUB_PAT（repo 权限）

function b64Decode(s){ return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))); }
function b64Encode(s){ return btoa(String.fromCharCode(...new TextEncoder().encode(s))); }
function json(o, st, ao){ return new Response(JSON.stringify(o), { status: st, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': ao } }); }
function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const FILE_PATH = 'super/index.html';
const MAX_KEYS = 20; // 保留最近 20 条自定义 key，超出删最旧

export async function onRequestOptions(){
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  const allowOrigin = allowed.includes('*') ? '*' : (allowed.find(o => origin.includes(o)) || '*');

  let body;
  try { body = await request.json(); } catch (e) { return json({ success: false, message: 'JSON 错误' }, 400, allowOrigin); }

  const url = (body.url || '').trim();
  const key = (body.key || '').trim();

  // 校验
  if (!/^https:\/\/pages-fast\.m\.taobao\.com\//i.test(url)) return json({ success: false, message: '只接受淘宝 pages-fast.m.taobao.com 链接' }, 400, allowOrigin);
  if (url.includes("'") || url.includes('"')) return json({ success: false, message: '链接不能含单/双引号' }, 400, allowOrigin);
  if (!/^self_[a-z0-9]+$/i.test(key)) return json({ success: false, message: '非法 key' }, 400, allowOrigin);

  const pat = env.GITHUB_PAT;
  if (!pat) return json({ success: false, message: '后端未配置 GITHUB_PAT' }, 500, allowOrigin);

  const owner = env.GITHUB_OWNER || 'doctorstrange1122';
  const repo = env.GITHUB_REPO || 'huafei';
  const branch = env.GITHUB_BRANCH || 'main';
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${FILE_PATH}?ref=${branch}`;
  const heads = { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'huafei-self-update', 'Content-Type': 'application/json' };

  // 1. 读取当前文件
  const getRes = await fetch(api, { headers: heads });
  if (!getRes.ok) return json({ success: false, message: '读取在线文档失败' }, 500, allowOrigin);
  const file = await getRes.json();
  let content = b64Decode(file.content);

  // 2. 构造隐藏按钮行（写入后端查表，中转端按 key 取链接）
  const newRow = `<button style="display:none" onclick="generateQRCodes(1, '${url}', '自定义', '${key}')" data-btn-key="${key}"></button>`;
  const keyRe = new RegExp("<button style=\"display:none\" onclick=\"generateQRCodes\\(1, '[^']*', '自定义', '" + escRe(key) + "'\\)\" data-btn-key=\"" + escRe(key) + "\"></button>");

  if (keyRe.test(content)) {
    content = content.replace(keyRe, newRow); // 同 key 更新
  } else {
    content = content.replace('</body>', '                ' + newRow + '\n</body>'); // 新增（置于 </body> 前）
  }

  // 3. 清理：保留最近 MAX_KEYS 条自定义隐藏按钮，超出删最旧（文档中最靠前 = 最旧）
  const btnRe = /<button style="display:none" onclick="generateQRCodes\(1, '[^']*', '自定义', '(self_[a-z0-9]+)'\)" data-btn-key="\1"><\/button>/g;
  const all = [...content.matchAll(btnRe)];
  if (all.length > MAX_KEYS) {
    const excess = all.length - MAX_KEYS;
    for (let i = 0; i < excess; i++) {
      content = content.replace(all[i][0], '');
    }
  }

  // 4. 提交回 GitHub
  const putRes = await fetch(api, {
    method: 'PUT',
    headers: heads,
    body: JSON.stringify({ message: 'update custom self key: ' + key, content: b64Encode(content), sha: file.sha, branch })
  });
  if (!putRes.ok) return json({ success: false, message: '提交失败(' + putRes.status + ')' }, 500, allowOrigin);
  const putData = await putRes.json();

  // 5. 轮询 raw 确认 CDN 已传播（no-store），最多 10 次 × 600ms
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${FILE_PATH}`;
  let propagated = false;
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(rawUrl, { cache: 'no-store' });
      if (r.ok && (await r.text()).includes(newRow)) { propagated = true; break; }
    } catch (e) {}
    await new Promise(res => setTimeout(res, 600));
  }

  // 6. 确认传播后强制中转端刷新缓存
  if (propagated) {
    try { await fetch('https://huafei-redirect-pages.pages.dev/refresh', { cache: 'no-store' }); } catch (e) {}
  }

  return json({ success: true, propagated, commit: putData.commit.sha }, 200, allowOrigin);
}
