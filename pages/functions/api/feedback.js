// 问题反馈接口（super/index.html 底部"有问题可点此反馈"提交）
// GET/POST 双支持（与 huafei-save 一致：WebView 内 POST JSON 的 CORS 预检偶发失败，GET 更稳）
// 存储：KV KEY_STORE，feedback:<时间戳>:<随机> = JSON {text, ts, ua}，90 天过期
// 防滥用：空内容/超500字拒绝；同一内容 60 秒内重复提交拒绝（fb_dup:<hash>）

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

// 简单字符串 hash（djb2），仅用于 60 秒去重，非安全场景
function hashText(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response('', { headers: CORS });
    }

    let text = '';
    try {
        if (request.method === 'GET') {
            const u = new URL(request.url);
            text = (u.searchParams.get('text') || '').trim();
        } else if (request.method === 'POST') {
            const body = await request.json();
            text = (body.text || '').trim();
        } else {
            return jsonResponse({ success: false, message: '仅支持 GET/POST 请求' }, 405);
        }
    } catch (e) {
        return jsonResponse({ success: false, message: '参数解析失败' }, 400);
    }

    if (!text) {
        return jsonResponse({ success: false, message: '请先输入反馈内容' }, 400);
    }
    if (text.length > 500) {
        return jsonResponse({ success: false, message: '反馈内容不能超过500字' }, 400);
    }

    const KV = env.KEY_STORE;
    if (!KV) {
        return jsonResponse({ success: false, message: 'KV 未配置' }, 500);
    }

    // 60 秒内相同内容拒绝（防连点/重复提交）
    const dupKey = 'fb_dup:' + hashText(text);
    try {
        const dup = await KV.get(dupKey);
        if (dup) {
            return jsonResponse({ success: false, message: '请勿重复提交相同内容' }, 429);
        }
    } catch (e) { /* KV 读取失败不阻断提交 */ }

    const ts = Date.now();
    const key = 'feedback:' + ts + ':' + Math.random().toString(36).slice(2, 8);
    const ua = request.headers.get('User-Agent') || '';
    // 简单机型信息（截断，避免过长）
    const uaShort = ua.slice(0, 200);
    const value = JSON.stringify({ text: text, ts: ts, ua: uaShort });

    try {
        await KV.put(dupKey, '1', { expirationTtl: 60 });
        // 90 天过期，自动清理
        await KV.put(key, value, { expirationTtl: 7776000 });
        return jsonResponse({ success: true, ts: ts });
    } catch (e) {
        return jsonResponse({ success: false, message: '存储失败，请稍后重试' }, 500);
    }
}
