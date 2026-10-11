// 管理员查看密钥列表 API
// POST /api/key/admin/list
// body: { adminPassword: "xxx" }
// 返回所有密钥的状态概览
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

        // 列出所有 key: 前缀的密钥
        const list = await KV.list({ prefix: 'key:', limit: 500 });
        const keys = [];

        for (const item of list.keys) {
            const data = await KV.get(item.name, { type: 'json' });
            if (data) {
                keys.push({
                    key: data.key,
                    activated: data.activated || false,
                    revoked: data.revoked || false,
                    deviceId: data.deviceId || null,
                    activatedAt: data.activatedAt || null,
                    createdAt: data.createdAt || null
                });
            }
        }

        // 按创建时间倒序
        keys.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        const stats = {
            total: keys.length,
            activated: keys.filter(k => k.activated && !k.revoked).length,
            unused: keys.filter(k => !k.activated && !k.revoked).length,
            revoked: keys.filter(k => k.revoked).length
        };

        return new Response(JSON.stringify({
            success: true,
            stats,
            keys
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
