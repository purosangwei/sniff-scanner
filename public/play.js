// Play (from the Desk site): the Gavcoin site's tricks (letters that wander, labels that decode, a ghost text layer,
// typed code, rare little surprises), slowed down and softened so they feel like things in water.
// Everything here is decoration: nothing on the page depends on it, and it all stops for
// reduced motion.

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const dev = /[?&]dev=1/.test(location.search);
const R = (a, b) => a + Math.random() * (b - a);
const pick = (arr, n) => arr.slice().sort(() => Math.random() - 0.5).slice(0, n);
const lerp = (a, b, k) => a + (b - a) * k;
const visible = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0; };
const anim = (el, frames, opts) => {
  el._busy = true;
  const a = el.animate(frames, opts);
  a.onfinish = a.oncancel = () => { el._busy = false; };
  return a;
};

// ------------------------------------------------------------------ surfacing intro

(function intro() {
  if (reduced || dev) return;
  let seen = false;
  try { seen = sessionStorage.getItem('sniff.intro') === '1'; sessionStorage.setItem('sniff.intro', '1'); } catch {}
  if (seen) return;
  const lines = [
    '<b>sniff</b> · repo scanner',
    'diving in ..................... <s>ok</s>',
    'loading red flags ............. <s>ok</s>',
    'reading files ................. <s>ok</s>',
    'code run on this server ....... <b>none</b>',
    '',
    'ready. scan it before you run it.',
  ];
  const boot = document.createElement('div');
  boot.id = 'boot';
  boot.setAttribute('aria-hidden', 'true');
  boot.innerHTML = '<div><div class="pane"><div class="pane-top"><i></i><i></i><i></i><span>sniff · diving in</span></div><pre></pre></div><small>click anywhere to skip</small></div>';
  document.body.appendChild(boot);
  const pre = boot.querySelector('pre');
  let done = false;
  const close = () => { if (done) return; done = true; boot.classList.add('out'); setTimeout(() => boot.remove(), 1700); };
  boot.addEventListener('click', close);
  addEventListener('keydown', close, { once: true });
  let li = 0;
  const next = () => {
    if (done) return;
    if (li >= lines.length) { setTimeout(close, 650); return; }
    pre.innerHTML += (li ? '\n' : '') + lines[li++];
    setTimeout(next, li === lines.length ? 420 : R(170, 300));
  };
  setTimeout(next, 250);
})();

// ------------------------------------------------------------------ headings split into letters

const heads = [...document.querySelectorAll('.hero h1, h2[data-rise], .how h3')];
function split(el) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walk.nextNode())) if (n.nodeValue.trim()) nodes.push(n);
  for (const t of nodes) {
    const f = document.createDocumentFragment();
    for (const part of t.nodeValue.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { f.appendChild(document.createTextNode(part)); continue; }
      const w = document.createElement('span');
      w.className = 'wd';
      for (const ch of part) {
        const c = document.createElement('span');
        c.className = 'ch';
        c.textContent = ch;
        w.appendChild(c);
      }
      f.appendChild(w);
    }
    t.parentNode.replaceChild(f, t);
  }
}
if (!reduced) {
  for (const h of heads) {
    if (!h.hasAttribute('aria-label')) h.setAttribute('aria-label', h.textContent.trim());
    split(h);
    // the letters are for looking at; the label above is what gets read out
    for (const w of h.querySelectorAll('.wd')) w.setAttribute('aria-hidden', 'true');
  }
}
const letters = (h) => [...h.querySelectorAll('.ch')].filter((c) => !c._busy && c.textContent.trim());
const visHeads = () => heads.filter(visible);

// A few letters lift off like they caught a current, hang there, and settle back.
function wander() {
  const vis = visHeads();
  if (!vis.length) return;
  const h = vis[(Math.random() * vis.length) | 0];
  pick(letters(h), 1 + ((Math.random() * 3) | 0)).forEach((c, i) => {
    const y = -R(5, 13), x = R(-3, 3), r = R(-9, 9);
    anim(c, [
      { transform: 'none' },
      { transform: `translate(${x}px, ${y}px) rotate(${r}deg)`, offset: 0.35 },
      { transform: `translate(${x * 0.6}px, ${y * 0.8}px) rotate(${r * 0.5}deg)`, offset: 0.65 },
      { transform: 'none' },
    ], { duration: R(3600, 5200), delay: i * 260, easing: 'cubic-bezier(.45,0,.25,1)' });
  });
}

// Now and then one letter floats right up like a balloon, turns over, and drifts home.
function balloon() {
  const vis = visHeads();
  if (!vis.length) return false;
  const h = vis[(Math.random() * vis.length) | 0];
  const [c] = pick(letters(h), 1);
  if (!c) return false;
  const y = -R(28, 46), x = R(-10, 10), turn = Math.random() < 0.5 ? 360 : -360;
  anim(c, [
    { transform: 'none', opacity: 1 },
    { transform: `translate(${x}px, ${y}px) rotate(${turn * 0.5}deg)`, opacity: 0.75, offset: 0.4 },
    { transform: `translate(${x * 0.5}px, ${y * 0.9}px) rotate(${turn * 0.85}deg)`, opacity: 0.8, offset: 0.6 },
    { transform: `translate(0, 3px) rotate(${turn}deg)`, opacity: 1, offset: 0.88 },
    { transform: `rotate(${turn}deg)`, opacity: 1 },
  ], { duration: R(5200, 6800), easing: 'cubic-bezier(.4,0,.2,1)' });
  return true;
}

// Instead of a glitch, a word catches the light for a moment.
function shine() {
  const vis = visHeads();
  if (!vis.length) return;
  const ws = [...vis[(Math.random() * vis.length) | 0].querySelectorAll('.wd')];
  if (!ws.length) return;
  const w = ws[(Math.random() * ws.length) | 0];
  w.classList.remove('shine');
  void w.offsetWidth;
  w.classList.add('shine');
}

// Letters drift aside from the pointer like it's a hand in the water, then ease back.
const shy = new Map();
function shyLoop() {
  for (const [c, s] of shy) {
    s.vx += (s.tx - s.x) * 0.03; s.vy += (s.ty - s.y) * 0.03;
    s.vx *= 0.86; s.vy *= 0.86;
    s.x += s.vx; s.y += s.vy;
    c.style.translate = `${s.x.toFixed(2)}px ${s.y.toFixed(2)}px`;
    if (!s.near && Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.vx) + Math.abs(s.vy) < 0.04) {
      c.style.translate = ''; shy.delete(c);
    }
  }
  requestAnimationFrame(shyLoop);
}
if (!reduced && fine) {
  requestAnimationFrame(shyLoop);
  let pending = null, queued = false;
  addEventListener('pointermove', (e) => {
    pending = e;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const ev = pending;
      for (const s of shy.values()) { s.near = false; s.tx = 0; s.ty = 0; }
      for (const h of visHeads()) {
        const hr = h.getBoundingClientRect();
        if (ev.clientY < hr.top - 90 || ev.clientY > hr.bottom + 90) continue;
        for (const c of h.querySelectorAll('.ch')) {
          const s = shy.get(c) || { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
          const r = c.getBoundingClientRect();
          const cx = r.left + r.width / 2 - s.x, cy = r.top + r.height / 2 - s.y;
          const dx = cx - ev.clientX, dy = cy - ev.clientY, d = Math.hypot(dx, dy);
          if (d > 85) continue;
          const f = (1 - d / 85) * 9;
          s.tx = (dx / (d || 1)) * f; s.ty = (dy / (d || 1)) * f; s.near = true;
          shy.set(c, s);
        }
      }
    });
  }, { passive: true });
}

// ------------------------------------------------------------------ labels that decode

const GLYPHS = '·∘°˚◦~≈+*○';
function decode(el) {
  if (reduced || el._d) return;
  el._d = true;
  const txt = el.textContent, n = txt.length, max = 26;
  el.setAttribute('aria-label', txt);
  let f = 0;
  (function step() {
    f++;
    let out = '';
    for (let i = 0; i < n; i++) out += (i < (n * f) / max || txt[i] === ' ') ? txt[i] : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.textContent = out;
    if (f < max) setTimeout(step, 45); else el.textContent = txt;
  })();
}
const dio = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting) { decode(e.target); dio.unobserve(e.target); }
}, { threshold: 0.6 });
document.querySelectorAll('[data-scr]').forEach((el) => dio.observe(el));

// ------------------------------------------------------------------ ghost text in the deep
// Switched off for $SNIFF (less floating text).
if (false) {
  const phrases = ['scan it before you run it', 'read, never run', 'postinstall', 'folderOpen', 'no install', 'use a VM',
    'red flags', 'check the recruiter', 'not on your wallet laptop', 'eval(atob(…))'];
  const layer = document.createElement('div');
  layer.className = 'ghost-text';
  layer.setAttribute('aria-hidden', 'true');
  const rows = [];
  for (let i = 0; i < 9; i++) {
    const d = document.createElement('div');
    const run = pick(phrases, phrases.length).join('   ·   ');
    d.textContent = (run + '   ·   ').repeat(3);
    layer.appendChild(d);
    rows.push({ el: d, dir: i % 2 ? 1 : -1, speed: R(4, 9), depth: R(0.4, 1), off: R(0, 600) });
  }
  document.querySelector('canvas.tank')?.after(layer) ?? document.body.prepend(layer);
  let mx = innerWidth / 2, my = innerHeight / 2, cx = 0, cy = 0, t0 = performance.now();
  addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });
  (function loop(now) {
    const t = (now - t0) / 1000;
    cx = lerp(cx, (mx / innerWidth - 0.5), 0.03);
    cy = lerp(cy, (my / innerHeight - 0.5), 0.03);
    for (const r of rows) {
      const x = -r.off + r.dir * ((t * r.speed) % 900) - cx * 40 * r.depth;
      const y = -cy * 24 * r.depth + Math.sin(t * 0.15 + r.off) * 6;
      r.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
    requestAnimationFrame(loop);
  })(t0);
}

// ------------------------------------------------------------------ the trade, typed out

const trace = document.getElementById('trace');
// three invisible columns: file, what it does, verdict. Padding is worked out on the
// plain text so the tags don't throw the columns off.
const COL = [14, 32];
const strip = (t) => t.replace(/<[^>]+>/g, '');
// file names sit back (<i>), what each one does is lit in jelly cream (<u>), the verdict keeps its own colour
const WRAP = ['i', 'u'];
const row = (...cells) => '  ' + cells.map((c, i) => {
  const w = WRAP[i] ? `<${WRAP[i]}>${c}</${WRAP[i]}>` : c;
  return i < cells.length - 1 && COL[i] ? w + ' '.repeat(Math.max(1, COL[i] - strip(c).length)) : w;
}).join('');
const TRACE = [
  '<em>sniff</em> github.com/acme-hiring/<b>defi-dashboard-test</b>',
  '',
  row('package.json', 'postinstall → <b>node setup.js</b>', '<em>red flag</em>'),
  row('setup.js', 'eval(Buffer.from(…, base64))', '<em>red flag</em>'),
  row('setup.js', 'talks to 203.0.113.7:1224', '<em>red flag</em>'),
  row('.vscode', 'runs on folder open', '<em>red flag</em>'),
  '',
  row('files run', '<s>none ✓</s>'),
  row('verdict', '<b>don\'t run this</b>'),
].join('\n');
let typed = false;
function typeTrace() {
  if (!trace || typed) return;
  typed = true;
  if (reduced) { trace.innerHTML = TRACE; return; }
  let i = 0, out = '';
  (function step() {
    if (i >= TRACE.length) { trace.innerHTML = out + '<span class="caret"></span>'; return; }
    if (TRACE[i] === '<') { const j = TRACE.indexOf('>', i); out += TRACE.slice(i, j + 1); i = j + 1; }
    else out += TRACE[i++];
    trace.innerHTML = out + '<span class="caret"></span>';
    setTimeout(step, TRACE[i - 1] === '\n' ? 110 : 13);
  })();
}
if (trace) {
  const tio = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) { typeTrace(); tio.disconnect(); }
  }, { threshold: 0.4 });
  tio.observe(trace);
}

// ------------------------------------------------------------------ sheen follows the pointer on buttons

document.addEventListener('pointermove', (e) => {
  const b = e.target.closest?.('.gf-btn');
  if (!b) return;
  const r = b.getBoundingClientRect();
  b.style.setProperty('--bx', (e.clientX - r.left) + 'px');
  b.style.setProperty('--by', (e.clientY - r.top) + 'px');
}, { passive: true });

// ------------------------------------------------------------------ rare, quiet surprises

function floatWord(text, x, y) {
  const el = document.createElement('div');
  el.className = 'floater';
  el.textContent = text;
  el.setAttribute('aria-hidden', 'true');
  el.style.left = x + 'px'; el.style.top = y + 'px';
  document.body.appendChild(el);
  const sway = R(18, 40) * (Math.random() < 0.5 ? -1 : 1);
  el.animate([
    { transform: 'translate(-50%, 10px)', opacity: 0, filter: 'blur(4px)' },
    { transform: `translate(calc(-50% + ${sway * 0.4}px), -40px)`, opacity: 0.9, filter: 'blur(0)', offset: 0.25 },
    { transform: `translate(calc(-50% + ${-sway * 0.3}px), -120px)`, opacity: 0.7, offset: 0.65 },
    { transform: `translate(calc(-50% + ${sway}px), -200px)`, opacity: 0, filter: 'blur(5px)' },
  ], { duration: R(6500, 8500), easing: 'cubic-bezier(.3,0,.3,1)' }).onfinish = () => el.remove();
}
function bubbles(x, y, n = 8) {
  for (let i = 0; i < n; i++) {
    const b = document.createElement('div');
    b.className = 'bubble';
    const s = R(3, 9);
    b.style.width = b.style.height = s + 'px';
    b.style.left = x + R(-8, 8) + 'px'; b.style.top = y + 'px';
    document.body.appendChild(b);
    const rise = R(140, 260), sway = R(8, 22);
    b.animate([
      { transform: 'translate(0,0) scale(.6)', opacity: 0 },
      { transform: `translate(${sway}px, ${-rise * 0.3}px) scale(1)`, opacity: 0.9, offset: 0.2 },
      { transform: `translate(${-sway}px, ${-rise * 0.65}px)`, opacity: 0.7, offset: 0.6 },
      { transform: `translate(${sway * 0.5}px, ${-rise}px) scale(1.15)`, opacity: 0 },
    ], { duration: R(3800, 5600), delay: i * R(140, 320), easing: 'cubic-bezier(.3,0,.5,1)', fill: 'backwards' }).onfinish = () => b.remove();
  }
}
const SURPRISES = {
  _word() {
    const w = ['gm', 'blub', 'read, never run', 'shh… nothing ran', 'use a VM', 'scan first', 'no npm install yet'];
    floatWord(w[(Math.random() * w.length) | 0], R(0.15, 0.85) * innerWidth, R(0.55, 0.85) * innerHeight);
  },
  bubbles() {
    const cells = [...document.querySelectorAll('.gf-cell')].filter(visible);
    if (!cells.length) return false;
    const r = cells[(Math.random() * cells.length) | 0].getBoundingClientRect();
    bubbles(r.left + R(0.2, 0.8) * r.width, r.bottom - 6);
  },
  breath() {
    const cells = [...document.querySelectorAll('.gf-cell')].filter(visible);
    if (!cells.length) return false;
    const c = cells[(Math.random() * cells.length) | 0];
    c.classList.remove('breath'); void c.offsetWidth; c.classList.add('breath');
    setTimeout(() => c.classList.remove('breath'), 4600);
  },
  current() {
    // the ticker's current slackens, turns back for a while, then picks up again
    const a = document.querySelector('.drift div')?.getAnimations()[0];
    if (!a || !visible(a.effect.target)) return false;
    const steps = [0.6, 0.2, -0.3, -0.6, -0.6, -0.6, -0.3, 0.2, 0.6, 1];
    steps.forEach((r, i) => setTimeout(() => a.updatePlaybackRate(r), i * 700));
  },
};
let last = '';
function surprise() {
  if (document.hidden) return;
  const keys = Object.keys(SURPRISES).filter((k) => k !== last && k[0] !== '_');
  for (let tries = 0; tries < 4; tries++) {
    const k = keys[(Math.random() * keys.length) | 0];
    if (SURPRISES[k]() !== false) { last = k; return; }
  }
}

if (!reduced) {
  (function tickW() { setTimeout(() => { if (!document.hidden) wander(); tickW(); }, R(9000, 15000)); })();
  (function tickS() { setTimeout(() => { if (!document.hidden) shine(); tickS(); }, R(8000, 14000)); })();
  (function tickX() { setTimeout(() => { surprise(); tickX(); }, R(11000, 22000)); })();
}

window.__play = { floatWord, bubbles, balloon, shine, wander, SURPRISES };
