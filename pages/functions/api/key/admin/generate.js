// 管理员生成密钥 API
// POST /api/key/admin/generate
// body: { count: 50, adminPassword: "xxx", unlimited: false, durationDays: 30 }
// durationDays: 有效期天数（激活后起算）；默认 30；0 = 永久有效
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
        const count = parseInt(body.count) || 10;
        const unlimited = !!body.unlimited;

        // 有效期天数：未传默认 30；0 表示永久
        const rawDays = body.durationDays;
        let durationDays = 30;
        if (rawDays !== undefined && rawDays !== null && rawDays !== '') {
            const parsed = parseInt(rawDays);
            durationDays = isNaN(parsed) ? 30 : Math.max(0, parsed);
        }

        if (password !== ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ success: false, error: '密码错误' }), {
                status: 401,
                headers: corsHeaders
            });
        }

        if (count < 1 || count > 200) {
            return new Response(JSON.stringify({ success: false, error: '数量范围 1-200' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        const generated = [];
        const now = Date.now();

        for (let i = 0; i < count; i++) {
            const key = generateKey();
            const keyData = {
                key,
                activated: false,
                revoked: false,
                deviceId: null,
                activatedAt: null,
                createdAt: now,
                unlimited: unlimited,
                devices: [],
                durationDays: durationDays
                // expireAt 不在此刻写：激活时才按「激活时刻 + durationDays」算出绝对到期日
            };
            await KV.put(`key:${key}`, JSON.stringify(keyData));
            generated.push(key);
        }

        return new Response(JSON.stringify({
            success: true,
            count: generated.length,
            durationDays: durationDays,
            keys: generated
        }), { headers: corsHeaders });

    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 500,
            headers: corsHeaders
        });
    }
}

function generateKey() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆的 I O 0 1
    const parts = [];
    for (let p = 0; p < 3; p++) {
        let part = '';
        for (let i = 0; i < 4; i++) {
            part += chars[Math.floor(Math.random() * chars.length)];
        }
        parts.push(part);
    }
    return 'DT-' + parts.join('-');
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
