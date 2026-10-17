const HTML = __HTML__;
const MAX = 8 * 1024 * 1024;
async function pull(target) {
  let u;
  try { u = new URL(target); } catch { return new Response('That link is not a valid URL.', { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) return new Response('Only http and https links work.', { status: 400 });
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || u.hostname.endsWith('.local')) return new Response('That address is not allowed.', { status: 400 });
  let r;
  try {
    r = await fetch(u.toString(), { redirect: 'follow', headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 FastReader/1.0',
      'accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'accept-language': 'en-US,en;q=0.9' } });
  } catch (e) { return new Response('The site could not be reached.', { status: 502 }); }
  if (!r.ok) return new Response(`The site answered with error ${r.status}.`, { status: 502 });
  const type = r.headers.get('content-type') || '';
  if (!/text|html|xml|json/.test(type)) return new Response('That link is not a web page or text file.', { status: 415 });
  const buf = await r.arrayBuffer();
  if (buf.byteLength > MAX) return new Response('That page is too large (over 8 MB).', { status: 413 });
  const m = /charset=([^;]+)/i.exec(type);
  let text;
  try { text = new TextDecoder(m ? m[1].trim() : 'utf-8').decode(buf); } catch { text = new TextDecoder().decode(buf); }
  return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-source-type': type, 'cache-control': 'no-store' } });
}
export default { async fetch(req) {
  const u = new URL(req.url);
  if (u.pathname === '/api/fetch') return pull(u.searchParams.get('url') || '');
  if (u.pathname !== '/' && u.pathname !== '/index.html') return Response.redirect(u.origin + '/', 302);
  return new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' } });
} };
