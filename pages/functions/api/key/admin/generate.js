// 管理员生成密钥 API
// POST /api/key/admin/generate
// body: { count: 50, adminPassword: "xxx" }
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
                createdAt: now
            };
            await KV.put(`key:${key}`, JSON.stringify(keyData));
            generated.push(key);
        }

        return new Response(JSON.stringify({
            success: true,
            count: generated.length,
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
