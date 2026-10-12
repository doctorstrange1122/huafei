// 临时清理工具：删除一个 self_ 自定义中转 key（用完即删，不长期保留）
export async function onRequestPost(context) {
    const { request, env } = context;
    let key = '';
    try {
        const body = await request.json();
        key = (body.key || '').toString().trim();
    } catch (e) {}
    if (!/^self_[a-z0-9]{6,}$/i.test(key)) {
        return new Response(JSON.stringify({ success: false, error: 'invalid key' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    const KV = env.KEY_STORE;
    if (!KV) {
        return new Response(JSON.stringify({ success: false, error: 'no KV' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    await KV.delete('hfself:' + key);
    return new Response(JSON.stringify({ success: true, deleted: key }), {
        headers: { 'Content-Type': 'application/json' },
    });
}
