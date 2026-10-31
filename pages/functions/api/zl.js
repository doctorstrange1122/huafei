// 折淘客「高佣转链」接口（一步：淘口令/长链/短链 -> 带PID推广短链）
// 密钥从环境变量读取：ZTK_APPKEY、ZTK_SID、ZTK_PID
// 路由：/api/zl  （GET ?tkl=内容  &mode=raw 查看原始返回）
// 返回：{ ok, short, long, tkl, id, title, pic, raw }
//
// 折淘客只开非标准端口 10001/10000，Cloudflare fetch 不支持，用 cloudflare:sockets 直连。

import { connect } from 'cloudflare:sockets';

const HOSTS = [
  { host: 'api.zhetaoke.com', port: 10001 },
  { host: 'api.zhetaoke.cn', port: 10000 },
];

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  });
}

async function ztkGet(host, port, pathQuery, ms) {
  const socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
  const timer = setTimeout(() => { try { socket.close(); } catch (_) {} }, ms || 9000);
  try {
    const w = socket.writable.getWriter();
    await w.write(new TextEncoder().encode(
      `GET ${pathQuery} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n`
    ));
    w.releaseLock();
    const reader = socket.readable.getReader();
    const parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      if (parts.reduce((n, p) => n + p.length, 0) > 512 * 1024) break;
    }
    reader.releaseLock();
    const raw = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) { raw.set(p, off); off += p.length; }
    const text = new TextDecoder().decode(raw);
    const idx = text.indexOf('\r\n\r\n');
    if (idx < 0) throw new Error('bad http response');
    return JSON.parse(text.slice(idx + 4).trim());
  } finally {
    clearTimeout(timer);
    try { socket.close(); } catch (_) {}
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } });
  }
  const u = new URL(request.url);
  let content = u.searchParams.get('tkl') || u.searchParams.get('content') || u.searchParams.get('url') || '';
  if (!content && request.method === 'POST') {
    try { const b = await request.json(); content = b.tkl || b.content || b.url || ''; } catch (_) { content = await request.text(); }
  }
  content = String(content || '').trim();
  if (!content) return json({ ok: false, error: 'missing tkl/content' }, 400);

  // sid 允许用查询参数覆盖，便于区分「导购/发单/代理」授权类型（转链接口对 sid 类型敏感）
  const appkey = env.ZTK_APPKEY;
  const sid = (u.searchParams.get('sid') || env.ZTK_SID || '').trim();
  const pid = (u.searchParams.get('pid') || env.ZTK_PID || '').trim();
  if (!appkey || !sid) return json({ ok: false, error: 'missing ZTK_APPKEY/ZTK_SID' }, 500);

  const results = {};
  const c = encodeURIComponent(content);
  const pidQ = pid ? '&pid=' + encodeURIComponent(pid) : '';
  const numIid = u.searchParams.get('num_iid') || (String(content).match(/^\d{6,}$/) ? content : '');

  // 商品ID高佣转链（推荐：解析出口令/链接拿到 num_iid 后一步生成带PID推广短链）
  if (numIid) {
    for (const { host, port } of HOSTS) {
      try {
        const r = await ztkGet(host, port,
          `/api/open_gaoyongzhuanlian.ashx?appkey=${appkey}&sid=${sid}${pidQ}&num_iid=${encodeURIComponent(numIid)}`, 9000);
        results.zhuanlian_id = r;
        break;
      } catch (e) { results.err0 = String((e && e.message) || e); }
    }
  }

  for (const { host, port } of HOSTS) {
    try {
      const r = await ztkGet(host, port,
        `/api/open_gaoyongzhuanlian_tkl.ashx?appkey=${appkey}&sid=${sid}${pidQ}&tkl=${c}`, 9000);
      results.zhuanlian = r;
      break;
    } catch (e) { results.err1 = String((e && e.message) || e); }
  }
  for (const { host, port } of HOSTS) {
    try {
      const r = await ztkGet(host, port,
        `/api/open_shorturl_taobao_get.ashx?appkey=${appkey}&sid=${sid}&content=${c}`, 9000);
      results.shorturl = r;
      break;
    } catch (e) { results.err2 = String((e && e.message) || e); }
  }

  // 探针：用「猜你喜欢」取在售真实商品ID，再走一次转链，用于确认转链接口本身是否可用
  if (u.searchParams.get('probe') === 'guess') {
    try {
      const g = await ztkGet(HOSTS[0].host, HOSTS[0].port,
        `/api/open_item_guess_like2.ashx?appkey=${appkey}&sid=${sid}&page=1&page_size=3`, 9000);
      results.guess = g;
      const list = (g && g.tbk_dg_optimus_material_response && g.tbk_dg_optimus_material_response.result_list
        && g.tbk_dg_optimus_material_response.result_list.map_data) || [];
      const ids = list.map((it) => it.item_id || it.num_iid || it.itemId).filter(Boolean).slice(0, 3);
      results.guess_ids = ids;
      for (const id of ids) {
        try {
          const r = await ztkGet(HOSTS[0].host, HOSTS[0].port,
            `/api/open_gaoyongzhuanlian.ashx?appkey=${appkey}&sid=${sid}${pidQ}&num_iid=${id}`, 9000);
          (results.guess_zhuanlian ||= {})[String(id)] = r;
        } catch (e) { (results.guess_err ||= {})[String(id)] = String((e && e.message) || e); }
      }
    } catch (e) { results.guess_err = String((e && e.message) || e); }
    return json({ ok: true, probe: true, raw: results });
  }

  const z = Object.assign({}, results.zhuanlian_id || {}, results.zhuanlian || {});
  const short = z.shorturl || z.coupon_shorturl || z.tbk_short_url || (results.shorturl && results.shorturl.shorturl) || '';
  const long = z.longurl || z.coupon_longurl || z.tbk_url || z.url || '';
  return json({
    ok: !!short || !!long,
    short, long,
    id: String((String(long).match(/[?&]id=(\d{6,})/) || [])[1] || z.num_iid || z.item_id || ''),
    title: z.title || '', pic: z.pic_url || z.pict_url || '',
    raw: results,
  });
}
