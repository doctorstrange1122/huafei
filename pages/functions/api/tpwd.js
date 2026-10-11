// 淘宝官方API淘口令生成服务
// 使用 taobao.tbk.tpwd.create 接口生成淘口令
// 环境变量: TB_APP_KEY, TB_APP_SECRET

const API_URL = 'https://eco.taobao.com/router/rest';

// MD5 签名（使用 Web Crypto API）
async function md5(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('MD5', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// TOP 签名算法
async function sign(params, secret) {
    const sorted = Object.keys(params).sort();
    let str = secret;
    for (const key of sorted) {
        str += key + params[key];
    }
    str += secret;
    const md5Hex = await md5(str);
    return md5Hex.toUpperCase();
}

export async function onRequest(context) {
    const { request, env } = context;
    
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json; charset=utf-8'
    };

    if (request.method === 'OPTIONS') {
        return new Response('', { headers: corsHeaders });
    }

    try {
        const appKey = env.TB_APP_KEY;
        const appSecret = env.TB_APP_SECRET;

        if (!appKey || !appSecret) {
            return new Response(JSON.stringify({
                success: false,
                error: '服务未配置：缺少淘宝API密钥'
            }), { status: 500, headers: corsHeaders });
        }

        // 获取请求参数
        let urlParam = '';
        let textParam = '肥料任务';
        let logoParam = '';

        if (request.method === 'POST') {
            const body = await request.json();
            urlParam = body.url || '';
            textParam = body.text || textParam;
            logoParam = body.logo || logoParam;
        } else {
            const sp = new URL(request.url).searchParams;
            urlParam = sp.get('url') || '';
            textParam = sp.get('text') || textParam;
            logoParam = sp.get('logo') || logoParam;
        }

        if (!urlParam) {
            return new Response(JSON.stringify({
                success: false,
                error: '缺少 url 参数'
            }), { status: 400, headers: corsHeaders });
        }

        // 组装淘宝 API 请求参数
        const now = new Date();
        const timestamp = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + ' ' +
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0');

        const params = {
            method: 'taobao.tbk.tpwd.create',
            app_key: appKey,
            timestamp: timestamp,
            format: 'json',
            v: '2.0',
            sign_method: 'md5',
            url: urlParam,
            text: textParam
        };

        if (logoParam) {
            params.logo = logoParam;
        }

        // 签名
        params.sign = await sign(params, appSecret);

        // 发送请求
        const formBody = new URLSearchParams(params).toString();
        const resp = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formBody
        });

        const result = await resp.json();
        
        // 解析返回
        const response = result['tbk_tpwd_create_response'];
        if (response && response.data) {
            const data = response.data;
            return new Response(JSON.stringify({
                success: true,
                model: data.model || '',
                passwordSimple: data.password_simple || '',
                password: data.password || '',
                shortUrl: data.short_url || '',
                data: data
            }), { headers: corsHeaders });
        } else {
            const errorResp = result.error_response;
            const errorMsg = errorResp ? (errorResp.msg + (errorResp.sub_msg ? ' - ' + errorResp.sub_msg : '')) : '未知错误';
            return new Response(JSON.stringify({
                success: false,
                error: errorMsg,
                raw: result
            }), { status: 500, headers: corsHeaders });
        }

    } catch (e) {
        return new Response(JSON.stringify({
            success: false,
            error: e.message
        }), { status: 500, headers: corsHeaders });
    }
}
