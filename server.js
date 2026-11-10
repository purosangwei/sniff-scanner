'use strict';
// $SNIFF web server. Zero dependencies. Never executes scanned code:
// repos are read from an in-memory tarball and matched against text rules.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { scanGithub, scanArchive } = require('./lib/report');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_CONCURRENT = +process.env.MAX_CONCURRENT || 3;
const RATE = { windowMs: 10 * 60 * 1000, max: +process.env.RATE_MAX || 15 };
const SCAN_TIMEOUT = 45000;

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------- storage
const cache = new Map();
function saveResult(r) {
  cache.set(r.id, r);
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  fs.writeFile(path.join(DATA_DIR, r.id + '.json'), JSON.stringify(r), () => {});
}
function loadResult(id) {
  if (!/^[A-Za-z0-9]{6,16}$/.test(id)) return null;
  if (cache.has(id)) return cache.get(id);
  try { const r = JSON.parse(fs.readFileSync(path.join(DATA_DIR, id + '.json'), 'utf8')); cache.set(id, r); return r; }
  catch { return null; }
}

// ---------------------------------------------------------------- limits
const hits = new Map();
function rateOk(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < RATE.windowMs);
  if (list.length >= RATE.max) { hits.set(ip, list); return false; }
  list.push(now); hits.set(ip, list);
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < RATE.windowMs)) hits.delete(k); }, 60000).unref();

let running = 0;
const waiting = [];
async function withSlot(fn) {
  if (running >= MAX_CONCURRENT) {
    if (waiting.length >= 20) { const e = new Error('Lots of people scanning right now. Try again in a minute.'); e.userFacing = true; e.status = 503; throw e; }
    await new Promise(r => waiting.push(r));
  }
  running++;
  try {
    return await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => {
      const e = new Error('The scan took too long. Try again, or drop the zip instead.'); e.userFacing = true; rej(e);
    }, SCAN_TIMEOUT))]);
  } finally {
    running--;
    const next = waiting.shift(); if (next) next();
  }
}

// ---------------------------------------------------------------- http helpers
const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, Object.assign({ 'content-type': type, 'content-length': buf.length }, SEC_HEADERS, extra));
  res.end(buf);
}
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0] : req.socket.remoteAddress || '').trim();
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > max) { const e = new Error('That file is too big (25 MB max). Coding tests are usually tiny.'); e.userFacing = true; e.status = 413; reject(e); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.jpg': 'image/jpeg' };
function serveStatic(res, rel, req) {
  const p = path.normalize(path.join(PUBLIC, rel));
  if (!p.startsWith(PUBLIC)) return send(res, 404, 'Not found', 'text/plain');
  // videos are streamed with byte ranges (Safari won't play an mp4 without them)
  if (p.endsWith('.mp4')) return fs.stat(p, (err, st) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const m = /^bytes=(\d*)-(\d*)$/.exec((req && req.headers.range) || '');
    let start = 0, end = st.size - 1, code = 200;
    if (m) { start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]); end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1; code = 206; }
    if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    const h = Object.assign({}, SEC_HEADERS, { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'cache-control': 'public, max-age=86400' });
    if (code === 206) h['content-range'] = `bytes ${start}-${end}/${st.size}`;
    res.writeHead(code, h);
    fs.createReadStream(p, { start, end }).pipe(res);
  });
  fs.readFile(p, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(p)] || 'application/octet-stream', { 'cache-control': rel.endsWith('.html') ? 'no-cache' : 'public, max-age=300' });
  });
}
function errorOut(res, e) {
  if (!e.userFacing) console.error('[scan error]', e && e.stack || e);
  send(res, e.status || (e.userFacing ? 400 : 500), { error: e.userFacing ? e.message : 'Something went wrong on our side. Try again in a moment.' });
}

// ---------------------------------------------------------------- shared scan entry (web + bot)
async function runScan(kind, payload, ip) {
  if (ip && !rateOk(ip)) { const e = new Error("You've run a lot of scans in a short time. Give it ten minutes."); e.userFacing = true; e.status = 429; throw e; }
  const report = await withSlot(() => kind === 'github' ? scanGithub(payload.url) : scanArchive(payload.buf, payload.name));
  saveResult(report);
  console.log(`[scan] ${report.id} ${report.verdict} ${report.source.label} h=${report.counts.high} m=${report.counts.medium}`);
  return report;
}

// ---------------------------------------------------------------- routes
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && (p === '/' || /^\/r\/[A-Za-z0-9]{6,16}$/.test(p))) return serveStatic(res, 'index.html');
    if (req.method === 'GET' && p === '/healthz') return send(res, 200, { ok: true, running, waiting: waiting.length });
    if (req.method === 'GET' && p.startsWith('/api/r/')) {
      const r = loadResult(p.slice(7));
      return r ? send(res, 200, r, undefined, { 'cache-control': 'public, max-age=60' }) : send(res, 404, { error: "That result has expired or never existed. Run the scan again." });
    }
    if (req.method === 'POST' && p === '/api/scan') {
      const body = await readBody(req, 4096);
      let j; try { j = JSON.parse(body.toString('utf8')); } catch { j = {}; }
      const report = await runScan('github', { url: j.url }, clientIp(req));
      return send(res, 200, report);
    }
    if (req.method === 'POST' && p === '/api/upload') {
      const buf = await readBody(req, MAX_UPLOAD);
      if (!buf.length) return send(res, 400, { error: 'That file was empty.' });
      const name = decodeURIComponent(String(req.headers['x-filename'] || 'upload.zip')).replace(/[^\w.\- ()]/g, '_');
      const report = await runScan('upload', { buf, name }, clientIp(req));
      return send(res, 200, report);
    }
    if (req.method === 'GET' && /^\/(vendor\/|media\/)?[\w.-]+\.(js|css|svg|png|jpg|ico|txt|mp4)$/.test(p)) return serveStatic(res, p.slice(1), req);
    send(res, 404, 'Not found', 'text/plain');
  } catch (e) { errorOut(res, e); }
});

server.requestTimeout = 60000;
server.headersTimeout = 20000;
server.listen(PORT, () => console.log(`$SNIFF listening on :${PORT}`));

if (process.env.TELEGRAM_BOT_TOKEN) require('./bot').start({ runScan, publicUrl: process.env.PUBLIC_URL || `http://localhost:${PORT}` });

module.exports = { server, runScan };
