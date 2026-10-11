// huafei 自定义链接保存接口
// 同时支持 GET 与 POST（WebView 内 POST JSON 的 CORS 预检偶发失败，GET 更稳）
// 校验：url 必须是 https://pages-fast.m.taobao.com/ 开头；key 必须是 self_ 开头且合法
// 存储：KEY_STORE 的 hfself:<key> = url，30 天过期

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
};

function jsonResponse(data, status) {
    return new Response(JSON.stringify(data), {
        status: status || 200,
        headers: CORS
    });
}

function badRequest(message) {
    return jsonResponse({ success: false, message }, 400);
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response('', { headers: CORS });
    }

    let url = '';
    let key = '';

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

    if (!/^https:\/\/pages-fast\.m\.taobao\.com\//i.test(url)) {
        return badRequest('只支持淘宝 pages-fast.m.taobao.com 链接');
    }

    if (!/^self_[a-z0-9]{6,}$/i.test(key)) {
        return badRequest('非法 key');
    }

    const KV = env.KEY_STORE;
    if (!KV) {
        return jsonResponse({ success: false, message: 'KV 未配置' }, 500);
    }

    try {
        await KV.put('hfself:' + key, url, { expirationTtl: 2592000 });
        return jsonResponse({ success: true });
    } catch (e) {
        return jsonResponse({ success: false, message: e.message }, 500);
    }
}
