// 管理员给单个密钥设置/清除备注 API
// POST /api/key/admin/set-note
// body: { key: "DT-XXXX-...", note: "备注文字", adminPassword: "xxx" }
//   note 为空字符串 = 清除备注
// 说明：备注仅存在 KV 的 key:xxx.note 字段，不影响激活/有效期/设备绑定等逻辑。
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

        const key = String(body.key || '').trim().toUpperCase();
        if (!key) {
            return new Response(JSON.stringify({ success: false, error: '密钥不能为空' }), {
                status: 400,
                headers: corsHeaders
            });
        }

        // 备注：去首尾空白，限制 200 字符，空串即清除
        let note = String(body.note == null ? '' : body.note).trim();
        if (note.length > 200) note = note.slice(0, 200);

        const storageKey = `key:${key}`;
        const keyData = await KV.get(storageKey, { type: 'json' });
        if (!keyData) {
            return new Response(JSON.stringify({ success: false, error: '密钥不存在' }), {
                status: 404,
                headers: corsHeaders
            });
        }

        if (note) {
            keyData.note = note;
            keyData.noteAt = Date.now();
        } else {
            delete keyData.note;
            delete keyData.noteAt;
        }
        await KV.put(storageKey, JSON.stringify(keyData));

        return new Response(JSON.stringify({
            success: true,
            key,
            note: note || ''
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
