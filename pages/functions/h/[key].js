// huafei 自定义链接中转页
// 访问 /h/<key>?pid=<商品id>
// 从 KV 取 self key 对应的真实链接，替换 itemIds 后返回唤起淘宝的 HTML
// 中转页逻辑统一复用 _lib.js 的 buildTransitHtml（与 r/[key].js 保持一致，避免重复实现漂移）

import { buildTransitHtml } from '../_lib.js';

function htmlResponse(body, status) {
    return new Response(body, {
        status: status || 200,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // 中转页逻辑更新频繁，禁止任何中间层/浏览器缓存旧版跳转代码
            'Cache-Control': 'no-store',
        }
    });
}

export async function onRequest(context) {
    const { request, env, params } = context;
    const key = params.key ? decodeURIComponent(params.key) : '';
    const url = new URL(request.url);
    const pid = url.searchParams.get('pid') || '';

    if (!key) {
        return htmlResponse('<p>用法：/h/&lt;key&gt;?pid=&lt;商品id&gt;</p>', 400);
    }

    if (!/^self_[a-z0-9]{6,}$/i.test(key)) {
        return htmlResponse('<p>无效的跳转标识：' + key + '</p>', 404);
    }

    const KV = env.KEY_STORE;
    if (!KV) {
        return htmlResponse('<p>服务未配置</p>', 500);
    }

    let target = await KV.get('hfself:' + key);

    if (!target) {
        return htmlResponse('<p>该二维码已失效，请重新生成</p>', 404);
    }

    if (pid) {
        // 兼容两种参数名：淘宝活动页用 itemIds=，农场兑换链接用 index?id=
        if (/[?&]itemIds=/.test(target)) {
            target = target.replace(/itemIds=[^&]+/, 'itemIds=' + pid);
        } else if (/[?&]id=/.test(target)) {
            target = target.replace(/([?&]id=)[^&]+/, '$1' + pid);
        }
    }

    return htmlResponse(buildTransitHtml(target));
}
