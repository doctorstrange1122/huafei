// 验证密钥 API
// POST /api/key/verify
// body: { key: "DT-XXXX-XXXX-XXXX", deviceId: "uuid" }

// 固定测试密钥（与 activate.js 保持一致）：不查 KV、不校验设备，任何设备验证都通过。
// 安全提醒：该字符串外泄即等于永久授权，仅用于测试。
const TEST_KEY = 'DT-TEST-TEST-TEST';

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

        // 固定测试密钥：跳过 KV 与设备校验，任何设备都视为有效
        if (key === TEST_KEY) {
            return new Response(JSON.stringify({
                valid: true,
                activated: true,
                activatedAt: Date.now(),
                testKey: true
            }), { headers: corsHeaders });
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
