'use strict';
// Telegram bot: /scan <github link>, or send a .zip. Long polling, no dependencies.
// Every call has a deadline, so a hung connection can't stall the poll loop.
const TG = token => (method, body, ms = 30000) => fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  signal: AbortSignal.timeout(ms),
}).then(r => r.json());

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const DOT = { red: '🔴', amber: '🟠', clear: '⚪' };

function format(r, publicUrl) {
  const c = r.coverage;
  const lines = [
    `${DOT[r.verdict]} <b>${esc(r.headline)}</b>`,
    `<i>${esc(r.source.label)}</i> · ${c.files} files, ${c.deps} dependencies checked`,
    '',
    ...r.summary.map(s => '• ' + esc(s)),
  ];
  const top = r.findings.filter(f => f.severity === 'high' || f.severity === 'medium').slice(0, 4);
  if (top.length && r.summary.length < 2) { lines.push(''); top.forEach(f => lines.push(`• ${esc(f.title)}${f.file ? ` <code>${esc(f.file)}</code>` : ''}`)); }
  lines.push('', esc(r.note), '', `Full report: ${publicUrl.replace(/\/$/, '')}/r/${r.id}`);
  return lines.join('\n');
}

const HELP = [
  'Send me a GitHub link or a zip before you run it.',
  '',
  '/scan github.com/owner/repo',
  'or just send the .zip file.',
  '',
  "I read the files and never run them. I flag known tricks malicious repos use. No known red flags is a good sign, not a guarantee, so use a VM if you don't know who made it.",
].join('\n');

function start({ runScan, publicUrl }) {
  const api = TG(process.env.TELEGRAM_BOT_TOKEN);
  let offset = 0;
  const reply = (chat, text, replyTo) => api('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_to_message_id: replyTo, allow_sending_without_reply: true });

  async function handle(msg) {
    const chat = msg.chat.id;
    const who = 'tg:' + (msg.from && msg.from.id || chat);
    const text = (msg.text || msg.caption || '').trim();
    try {
      if (msg.document) {
        const d = msg.document;
        if (!/\.(zip|tgz|tar\.gz)$/i.test(d.file_name || '')) return reply(chat, 'Send the test as a .zip and I\'ll scan it.', msg.message_id);
        if (d.file_size > 20 * 1024 * 1024) return reply(chat, 'Telegram only lets bots download files up to 20 MB. Upload it on the website instead.', msg.message_id);
        await reply(chat, 'Scanning…', msg.message_id);
        const f = await api('getFile', { file_id: d.file_id });
        const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.result.file_path}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const r = await runScan('upload', { buf, name: d.file_name }, who);
        return reply(chat, format(r, publicUrl), msg.message_id);
      }
      const m = text.match(/^\/scan(?:@\w+)?\s+(\S+)/i) || text.match(/^(https?:\/\/)?(www\.)?github\.com\/\S+/i);
      if (m) {
        const link = m[1] && !/^https?:\/\/$/.test(m[1]) ? m[1] : m[0];
        await reply(chat, 'Scanning…', msg.message_id);
        const r = await runScan('github', { url: link }, who);
        return reply(chat, format(r, publicUrl), msg.message_id);
      }
      if (/^\/(start|help)/i.test(text) || (msg.chat.type === 'private' && text)) return reply(chat, HELP);
    } catch (e) {
      return reply(chat, esc(e.userFacing ? e.message : 'Something went wrong. Try again in a moment.'), msg.message_id);
    }
  }

  // Remember what we've already handled, so a message that Telegram hands over twice is only scanned once.
  const seen = new Map();
  const firstTime = key => {
    if (seen.has(key)) return false;
    seen.set(key, Date.now());
    if (seen.size > 2000) for (const [k, t] of seen) { if (Date.now() - t > 3600e3) seen.delete(k); }
    return true;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  (async function poll() {
    for (;;) {
      try {
        const r = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }, 65000);
        if (!r.ok) { console.log(`[bot] getUpdates failed: ${r.error_code} ${r.description}`); await sleep(5000); continue; }
        for (const u of r.result) {
          offset = Math.max(offset, u.update_id + 1);
          const m = u.message;
          if (!m) continue;
          const fresh = firstTime('u' + u.update_id) & firstTime(m.chat.id + ':' + m.message_id);
          if (!fresh) { console.log(`[bot] skipped repeat update ${u.update_id}`); continue; }
          console.log(`[bot] update ${u.update_id} msg ${m.message_id}`);
          handle(m);
        }
      } catch (e) { await sleep(5000); }
    }
  })();
  console.log('Telegram bot polling');
}

module.exports = { start, format };
