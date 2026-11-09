// 手动记录「是否可用」标记的存储接口
// 存储：KV KEY_STORE，key = "mstatus:" + 行标识（sceneId/deliveryId，无参数时用奖励名）
// value 仅允许 ""（清除）/ "可用" / "失效"，永久保存（不设过期）
// GET  -> 返回全部标记（便于核对）；POST -> 写入或清除单个标记
// 说明：/links 是公开页面，这里不设密钥；靠 key 格式 + value 白名单约束，避免写入任意 KV

const PREFIX = "mstatus:";
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
};

function jsonResponse(data, status) {
    return new Response(JSON.stringify(data), { status: status || 200, headers: CORS });
}

// 行标识：形如 "5387/88506" 或 "name/5000饲料"
// 排除控制字符与 CSV/HTML 敏感字符即可，其余（含中文、括号、圈号）都放行
function validKey(k) {
    if (typeof k !== 'string') return false;
    if (k.length < 1 || k.length > 96) return false;
    return /^[^\x00-\x1f,"'`\\<>&]{1,96}$/.test(k);
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response('', { headers: CORS });
    }

    const KV = env.KEY_STORE;
    if (!KV) {
        return jsonResponse({ ok: false, error: 'KV 未配置' }, 500);
    }

    // GET：列出全部标记（KV list 有最终一致性延迟，仅用于核对，不用于页面渲染）
    if (request.method === 'GET') {
        try {
            const marks = {};
            let cursor;
            do {
                const opts = { prefix: PREFIX };
                if (cursor) opts.cursor = cursor;
                const res = await KV.list(opts);
                for (const k of res.keys) {
                    const v = await KV.get(k.name);
                    if (v === '可用' || v === '失效') marks[k.name.slice(PREFIX.length)] = v;
                }
                cursor = res.list_complete ? undefined : res.cursor;
            } while (cursor);
            return jsonResponse({ ok: true, total: Object.keys(marks).length, marks });
        } catch (e) {
            return jsonResponse({ ok: false, error: e.message }, 500);
        }
    }

    if (request.method !== 'POST') {
        return jsonResponse({ ok: false, error: '仅支持 GET/POST 请求' }, 405);
    }

    let body;
    try { body = await request.json(); } catch (e) {
        return jsonResponse({ ok: false, error: '请求体不是合法 JSON' }, 400);
    }
    const key = String((body && body.key) ?? '').trim();
    const value = String((body && body.value) ?? '').trim();

    if (!validKey(key)) {
        return jsonResponse({ ok: false, error: '非法行标识' }, 400);
    }
    if (value !== '' && value !== '可用' && value !== '失效') {
        return jsonResponse({ ok: false, error: '取值只能是 空白 / 可用 / 失效' }, 400);
    }

    try {
        if (value === '') {
            await KV.delete(PREFIX + key);
        } else {
            await KV.put(PREFIX + key, value);
        }
        return jsonResponse({ ok: true, key, value });
    } catch (e) {
        return jsonResponse({ ok: false, error: e.message }, 500);
    }
}
