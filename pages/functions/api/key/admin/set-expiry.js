// 管理员续期 / 重设有效期 API
// POST /api/key/admin/set-expiry
// body: { keys: ["DT-XXXX-...", ...], days: 30, adminPassword: "xxx" }
//   keys: 单个或多个密钥（数组）
//   days: 从「现在」起算的有效天数；0 = 设为永久有效（清除到期时间）
// 说明：续期从当前时刻起算（逾期也能救活），设备绑定不变，用户原设备点「我已续期，重新验证」即可恢复。
export async function onRequestPost(context) {
    const { request, env } = context;
    const KV = env.KEY_STORE;
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'admin123456';

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    try {
        const body = await request.json();
        const password = body.adminPassword || '';

        if (password !== ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ success: false, error: '密码错误' }), {
                status: 401,
                headers: corsHeaders
            });
        }

        // 归一化密钥列表：兼容单个字符串与数组
        let keys = body.keys;
        if (typeof keys === 'string') keys = [keys];
        if (!Array.isArray(keys)) keys = body.key ? [body.key] : [];
        keys = keys.map(k => String(k || '').trim().toUpperCase()).filter(Boolean);

        if (keys.length === 0) {
            return new Response(JSON.stringify({ success: false, error: '密钥不能为空' }), {
                status: 400,
                headers: corsHeaders
            });
        }
        if (keys.length > 200) {
            return new Response(JSON.stringify({ success: false, error: '单次最多 200 个' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        const rawDays = body.days;
        let days = 30;
        if (rawDays !== undefined && rawDays !== null && rawDays !== '') {
            const parsed = parseInt(rawDays);
            days = isNaN(parsed) ? 30 : Math.max(0, parsed);
        }

        const DAY_MS = 86400000;
        const now = Date.now();
        const expireAt = days > 0 ? now + days * DAY_MS : 0;
        const updated = [];
        const missing = [];

        for (const key of keys) {
            const keyData = await KV.get(`key:${key}`, { type: 'json' });
            if (!keyData) {
                missing.push(key);
                continue;
            }
            keyData.expireAt = expireAt;
            keyData.durationDays = days; // 同步天数规则，便于后续再次续期/展示
            await KV.put(`key:${key}`, JSON.stringify(keyData));
            updated.push(key);
        }

        return new Response(JSON.stringify({
            success: true,
            updated: updated.length,
            missing,
            days,
            expireAt
        }), { headers: corsHeaders });

    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 500,
            headers: corsHeaders
        });
    }
}

export async function onRequestOptions(context) {
    return new Response('', {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        }
    });
}
