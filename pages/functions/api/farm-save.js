// farm-exchange 自定义链接保存接口
// 把 self_ key 写回 farm-exchange 仓库的 data/self_keys.csv 文档（自建存储、永不失效）
// 这样 key 完全由 farm-exchange 自己拥有，不会进入 huafei 的 KV，也就不会出现在 huafei /links。
// 需要环境变量 GH_PAT（对 farm-exchange 仓库有 repo 写权限的 GitHub Token）。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

const REPO = 'doctorstrange1122/farm-exchange';
const CSV_PATH = 'data/self_keys.csv';
const GH_API = 'https://api.github.com';

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: CORS });
}
function badRequest(message) {
  return jsonResponse({ success: false, message }, 400);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response('', { headers: CORS });

  let url = '', key = '';
  try {
    if (request.method === 'GET') {
      const u = new URL(request.url);
      url = (u.searchParams.get('url') || '').trim();
      key = (u.searchParams.get('key') || '').trim();
    } else if (request.method === 'POST') {
      const body = await request.json();
      url = (body.url || '').trim();
      key = (body.key || '').trim();
    } else {
      return jsonResponse({ success: false, message: '仅支持 GET/POST 请求' }, 405);
    }
  } catch (e) {
    return badRequest('参数解析失败');
  }

  // 仅允许淘宝 pages-fast / pages-g 链接
  if (!/^https:\/\/pages-(fast|g)\.m\.taobao\.com\//i.test(url)) {
    return badRequest('只支持淘宝 pages-fast / pages-g 链接');
  }
  // 仅允许 self_ 前缀的 key
  if (!/^self_[a-z0-9]{6,}$/i.test(key)) {
    return badRequest('非法 key');
  }

  const GH_PAT = env.GH_PAT;
  if (!GH_PAT) {
    return jsonResponse({ success: false, message: '服务未配置 GH_PAT' }, 500);
  }

  const headers = {
    'Authorization': 'Bearer ' + GH_PAT,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'farm-save'
  };
  const apiUrl = GH_API + '/repos/' + REPO + '/contents/' + CSV_PATH;

  try {
    // 1) 读取现有 CSV（拿到 sha 与内容）
    const getRes = await fetch(apiUrl + '?ref=main', { headers });
    let sha = null;
    let text = '';
    if (getRes.status === 200) {
      const data = await getRes.json();
      sha = data.sha;
      text = Buffer.from(data.content, 'base64').toString('utf-8');
    } else if (getRes.status !== 404) {
      return jsonResponse({ success: false, message: '读取存储文档失败(' + getRes.status + ')' }, 500);
    }

    // 2) 追加一行（去重：已存在同 key 则跳过写入）
    const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => l.length);
    const exists = lines.some(l => l.split(',')[0].trim() === key);
    if (!exists) {
      const ts = new Date().toISOString();
      const newRow = key + ',' + url + ',' + ts + '\n';
      const newText = (text && text.trim().length ? (text.endsWith('\n') ? text : text + '\n') : '') + newRow;
      const putBody = {
        message: 'farm-exchange: add self key ' + key,
        content: Buffer.from(newText, 'utf-8').toString('base64'),
        branch: 'main'
      };
      if (sha) putBody.sha = sha;
      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: JSON.stringify(putBody)
      });
      if (!putRes.ok) {
        const err = await putRes.text();
        return jsonResponse({ success: false, message: '写入存储文档失败(' + putRes.status + ')' }, 500);
      }
    }
    return jsonResponse({ success: true });
  } catch (e) {
    return jsonResponse({ success: false, message: e.message }, 500);
  }
}

// redeploy trigger: bind GH_PAT env
