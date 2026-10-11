// 伪短链生成接口
// POST /api/shorten  body: { url: "xxx" }
// 返回短码 code，短链地址为 /s/{code}

function generateCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

export async function onRequest(context) {
    const { request, env } = context;
    
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json; charset=utf-8'
    };

    if (request.method === 'OPTIONS') {
        return new Response('', { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ success: false, error: '仅支持POST请求' }), {
            status: 405,
            headers: corsHeaders
        });
    }

    try {
        const body = await request.json();
        const url = body.url || '';

        if (!url) {
            return new Response(JSON.stringify({ success: false, error: '缺少 url 参数' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        // 验证URL
        if (!/^https?:\/\//i.test(url)) {
            return new Response(JSON.stringify({ success: false, error: '无效的URL格式' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        const KV = env.KEY_STORE;
        if (!KV) {
            return new Response(JSON.stringify({ success: false, error: 'KV存储未配置' }), {
                status: 500,
                headers: corsHeaders
            });
        }

        // 生成短码（防冲突：最多重试10次）
        let code;
        let exists = true;
        let attempts = 0;
        while (exists && attempts < 10) {
            code = generateCode();
            exists = await KV.get(`short:${code}`);
            attempts++;
        }

        if (exists) {
            return new Response(JSON.stringify({ success: false, error: '生成短码失败，请重试' }), {
                status: 500,
                headers: corsHeaders
            });
        }

        // 存储到 KV，有效期30天
        await KV.put(`short:${code}`, url, { expirationTtl: 2592000 });

        const baseUrl = new URL(request.url).origin;
        const shortUrl = `${baseUrl}/s/${code}`;

        return new Response(JSON.stringify({
            success: true,
            code: code,
            shortUrl: shortUrl,
            expiresIn: 2592000
        }), { headers: corsHeaders });

    } catch (e) {
        return new Response(JSON.stringify({
            success: false,
            error: e.message
        }), { status: 500, headers: corsHeaders });
    }
}
