// 激活密钥 API
// POST /api/key/activate
// body: { key: "DT-XXXX-XXXX-XXXX", deviceId: "uuid" }

// 固定测试密钥：不写入 KV、不绑定设备，任何设备反复激活都直接通过，方便联调测试。
// 安全提醒：该字符串一旦外泄，任何人都能激活使用；仅用于测试，正式环境请从下方常量移除。
const TEST_KEY = 'DT-TEST-TEST-TEST';

const DAY_MS = 86400000;

// 计算到期时间：已有 expireAt（含后台续期写入的）保留，不重复计算；
// 否则按生成时定的 durationDays 从激活时刻起算；durationDays<=0 或缺失 = 永久（老密钥兼容）
function calcExpireAt(keyData, now) {
    if (keyData.expireAt && keyData.expireAt > 0) return keyData.expireAt;
    const days = Number(keyData.durationDays);
    if (days > 0) return now + days * DAY_MS;
    return 0; // 0 = 永久有效
}

// 是否已过期：expireAt>0 且当前时间已超过即视为过期；无到期时间 = 永不过期
function isExpired(keyData, now) {
    return !!(keyData.expireAt && keyData.expireAt > 0 && now > keyData.expireAt);
}

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

        // 已过期：拒绝激活，返回过期标记与密钥（供前端展示）
        if (isExpired(keyData, Date.now())) {
            return new Response(JSON.stringify({
                success: false,
                error: '密钥已过期，请联系续期',
                expired: true,
                expireAt: keyData.expireAt,
                key: keyData.key
            }), { status: 403, headers: corsHeaders });
        }

        // 不限次数密钥：任意设备可反复激活，不绑定单一设备
        if (keyData.unlimited) {
            const now = Date.now();
            if (!Array.isArray(keyData.devices)) keyData.devices = [];
            if (deviceId && !keyData.devices.includes(deviceId)) keyData.devices.push(deviceId);
            if (!keyData.activated) {
                keyData.activated = true;
                keyData.activatedAt = now;
                // 首次激活：按天数算出到期时间并落库
                keyData.expireAt = calcExpireAt(keyData, now);
            }
            keyData.deviceId = keyData.devices.join(',');
            await KV.put(`key:${key}`, JSON.stringify(keyData));
            return new Response(JSON.stringify({
                success: true,
                activated: true,
                activatedAt: keyData.activatedAt,
                expireAt: keyData.expireAt || 0,
                unlimited: true
            }), { headers: corsHeaders });
        }

        // 已激活的情况
        if (keyData.activated) {
            if (keyData.deviceId === deviceId) {
                // 同一设备重新激活，返回成功
                return new Response(JSON.stringify({
                    success: true,
                    activated: true,
                    activatedAt: keyData.activatedAt,
                    expireAt: keyData.expireAt || 0
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
        // 首次激活：按天数算出到期时间并落库
        keyData.expireAt = calcExpireAt(keyData, now);

        await KV.put(`key:${key}`, JSON.stringify(keyData));

        return new Response(JSON.stringify({
            success: true,
            activated: true,
            activatedAt: now,
            expireAt: keyData.expireAt || 0
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
