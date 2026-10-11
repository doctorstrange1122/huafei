// 伪短链跳转服务
// 访问 /s/{code} 从 KV 查找真实URL并302跳转

export async function onRequest(context) {
    const { request, env, params } = context;
    
    const code = params.code;

    if (!code) {
        return new Response('短链不能为空', { status: 400 });
    }

    const KV = env.KEY_STORE;
    if (!KV) {
        return new Response('服务未配置', { status: 500 });
    }

    const url = await KV.get(`short:${code}`);

    if (!url) {
        // 返回一个简单的HTML页面提示
        return new Response(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>短链无效</title></head>
            <body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:-apple-system,sans-serif;background:#f5f5f5;">
                <div style="text-align:center;padding:20px;background:white;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
                    <div style="font-size:48px;margin-bottom:12px;">😅</div>
                    <div style="font-size:16px;color:#333;">短链接不存在或已过期</div>
                </div>
            </body>
            </html>
        `, {
            status: 404,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }

    // 302 跳转到真实URL
    return new Response(null, {
        status: 302,
        headers: {
            'Location': url,
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
    });
}
