// 管理员作废密钥 API
// POST /api/key/admin/revoke
// body: { key: "DT-XXXX-XXXX-XXXX", adminPassword: "xxx" }
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
        const key = (body.key || '').trim().toUpperCase();

        if (password !== ADMIN_PASSWORD) {
            return new Response(JSON.stringify({ success: false, error: '密码错误' }), {
                status: 401,
                headers: corsHeaders
            });
        }

        if (!key) {
            return new Response(JSON.stringify({ success: false, error: '密钥不能为空' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        const keyData = await KV.get(`key:${key}`, { type: 'json' });
        if (!keyData) {
            return new Response(JSON.stringify({ success: false, error: '密钥不存在' }), {
                status: 404,
                headers: corsHeaders
            });
        }

        keyData.revoked = true;
        keyData.revokedAt = Date.now();
        await KV.put(`key:${key}`, JSON.stringify(keyData));

        return new Response(JSON.stringify({
            success: true,
            message: '密钥已作废'
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
