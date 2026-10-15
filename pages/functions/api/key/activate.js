// 激活密钥 API
// POST /api/key/activate
// body: { key: "DT-XXXX-XXXX-XXXX", deviceId: "uuid" }

// 固定测试密钥：不写入 KV、不绑定设备，任何设备反复激活都直接通过，方便联调测试。
// 安全提醒：该字符串一旦外泄，任何人都能激活使用；仅用于测试，正式环境请从下方常量移除。
const TEST_KEY = 'DT-TEST-TEST-TEST';

export async function onRequestPost(context) {
    const { request, env } = context;
    const KV = env.KEY_STORE;

    // CORS 头
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
            return new Response(JSON.stringify({ success: false, error: '参数不完整' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        // 固定测试密钥：跳过 KV 与设备校验，任何设备都能反复激活
        if (key === TEST_KEY) {
            return new Response(JSON.stringify({
                success: true,
                activated: true,
                activatedAt: Date.now(),
                testKey: true
            }), { headers: corsHeaders });
        }

        // 从 KV 查找密钥
        const keyData = await KV.get(`key:${key}`, { type: 'json' });

        if (!keyData) {
            return new Response(JSON.stringify({ success: false, error: '密钥不存在' }), {
                status: 404,
                headers: corsHeaders
            });
        }

        if (keyData.revoked) {
            return new Response(JSON.stringify({ success: false, error: '密钥已作废' }), {
                status: 403,
                headers: corsHeaders
            });
        }

        // 已激活的情况
        if (keyData.activated) {
            if (keyData.deviceId === deviceId) {
                // 同一设备重新激活，返回成功
                return new Response(JSON.stringify({
                    success: true,
                    activated: true,
                    activatedAt: keyData.activatedAt
                }), { headers: corsHeaders });
            } else {
                // 不同设备，拒绝
                return new Response(JSON.stringify({
                    success: false,
                    error: '密钥已被其他设备使用'
                }), { status: 403, headers: corsHeaders });
            }
        }

        // 未激活，执行激活
        const now = Date.now();
        keyData.activated = true;
        keyData.activatedAt = now;
        keyData.deviceId = deviceId;

        await KV.put(`key:${key}`, JSON.stringify(keyData));

        return new Response(JSON.stringify({
            success: true,
            activated: true,
            activatedAt: now
        }), { headers: corsHeaders });

    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 500,
            headers: corsHeaders
        });
    }
}

// 处理 OPTIONS 预检请求
export async function onRequestOptions(context) {
    return new Response('', {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        }
    });
}
