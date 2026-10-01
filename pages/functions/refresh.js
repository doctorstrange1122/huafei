import { getButtonMap, forceRefresh } from './_lib.js';

export async function onRequestGet() {
  forceRefresh();
  const map = await getButtonMap(true);
  return new Response('已强制重新同步，当前识别到 ' + Object.keys(map).length + ' 个按钮', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
