// 验证密钥 API
// POST /api/key/verify
// body: { key: "DT-XXXX-XXXX-XXXX", deviceId: "uuid" }
export async function onRequestPost(context) {
    const { request, env } = context;
    const KV = env.KEY_STORE;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    try {
        const body = await request.json();
        const key = (body.key || '').trim().toUpperCase();
        const deviceId = (body.deviceId || '').trim();

        if (!key || !deviceId) {
            return new Response(JSON.stringify({ valid: false, error: '参数不完整' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        const keyData = await KV.get(`key:${key}`, { type: 'json' });

        if (!keyData || keyData.revoked || !keyData.activated) {
            return new Response(JSON.stringify({ valid: false }), { headers: corsHeaders });
        }

        if (keyData.deviceId !== deviceId) {
            return new Response(JSON.stringify({ valid: false }), { headers: corsHeaders });
        }

        return new Response(JSON.stringify({
            valid: true,
            activatedAt: keyData.activatedAt
        }), { headers: corsHeaders });

    } catch (e) {
        return new Response(JSON.stringify({ valid: false, error: e.message }), {
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
