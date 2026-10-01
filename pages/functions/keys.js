import { getButtonMap } from './_lib.js';

export async function onRequestGet() {
  const map = await getButtonMap();
  return new Response(JSON.stringify(Object.keys(map)), {
    headers: { 'Content-Type': 'application/json' },
  });
}
