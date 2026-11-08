(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var current = null;

  // ---------- glow follows the pointer
  document.querySelectorAll('.gf-cell').forEach(function (c) {
    c.addEventListener('pointermove', function (e) {
      var r = c.getBoundingClientRect();
      c.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      c.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  });

  // ---------- outputs roll to new values and pulse once
  function setOut(el, n, cls) {
    el.className = 'v ' + (cls || '');
    var from = el._v; if (from === n) return; el._v = n;
    var box = el.closest('.gf-cell'); box.classList.remove('pulse'); void box.offsetWidth; box.classList.add('pulse');
    var fmt = function (x) { return Math.round(x).toLocaleString('en-GB'); };
    if (from === undefined || reduced) { el.textContent = fmt(n); return; }
    var t0 = performance.now(); cancelAnimationFrame(el._raf);
    (function step(now) {
      var k = Math.min(1, (now - t0) / 380); k = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (n - from) * k); if (k < 1) el._raf = requestAnimationFrame(step);
    })(t0);
  }

  // ---------- live link check as you type
  function parseRepo(input) {
    var s = String(input || '').trim();
    if (!s) return null;
    s = s.replace(/^git\+/, '').replace(/^git@github\.com:/i, 'https://github.com/');
    if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = 'https://github.com/' + s;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try { var u = new URL(s); } catch (e) { return false; }
    if (!/^(www\.)?github\.com$/i.test(u.hostname)) return false;
    var p = u.pathname.split('/').filter(Boolean);
    if (p.length < 2) return false;
    var ref = (p[2] === 'tree' || p[2] === 'blob' || p[2] === 'commit') && p[3] ? decodeURIComponent(p[3]) : null;
    return { owner: p[0], repo: p[1].replace(/\.git$/i, ''), ref: ref };
  }
  var hint = $('repoHint'), defHint = hint.textContent;
  function liveHint() {
    var r = parseRepo($('repo').value);
    hint.className = 'gf-hint';
    if (r === null) { hint.textContent = defHint; return; }
    if (r === false) { hint.textContent = "That isn't a GitHub repo link yet. It should look like github.com/owner/repo."; return; }
    hint.className = 'gf-hint ok';
    hint.textContent = '';
    var b1 = document.createElement('b'); b1.textContent = r.owner + ' / ' + r.repo;
    hint.append('Ready to scan ', b1, r.ref ? ' on branch ' + r.ref : ' (default branch)');
  }
  $('repo').addEventListener('input', liveHint);

  // ---------- status line
  function status(msg, kind) {
    var el = $('status');
    el.className = 'status' + (kind === 'err' ? ' err' : '');
    el.textContent = '';
    if (kind === 'busy') { var s = document.createElement('span'); s.className = 'spin'; el.append(s); }
    if (msg) el.append(msg);
  }
  function busy(on) { $('go').disabled = on; $('go').textContent = on ? 'Scanning…' : 'Scan it'; }

  // ---------- scanning
  function post(url, body, headers) {
    return fetch(url, { method: 'POST', body: body, headers: headers }).then(function (res) {
      return res.json().catch(function () { return { error: 'Unexpected reply from the server.' }; }).then(function (j) {
        if (!res.ok || j.error) throw new Error(j.error || 'Scan failed.');
        return j;
      });
    });
  }
  function scanLink() {
    var v = $('repo').value.trim();
    var r = parseRepo(v);
    if (!r) { status(r === null ? 'Paste a GitHub link first, or drop the zip.' : "That isn't a GitHub repo link.", 'err'); $('repo').focus(); return; }
    busy(true); status('Downloading and reading the files. Usually a few seconds.', 'busy');
    post('/api/scan', JSON.stringify({ url: v }), { 'content-type': 'application/json' })
      .then(done).catch(fail);
  }
  function scanFile(f) {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { status('That file is over 25 MB. Coding tests are usually much smaller.', 'err'); return; }
    if (!/\.(zip|tgz|tar\.gz|gz)$/i.test(f.name)) { status('Drop a .zip of the project.', 'err'); return; }
    busy(true); status('Reading ' + f.name + '…', 'busy');
    post('/api/upload', f, { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) })
      .then(done).catch(fail);
  }
  function done(r) {
    busy(false); status('');
    render(r);
    try { history.pushState({ id: r.id }, '', '/r/' + r.id); } catch (e) {}
    $('result').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }
  function fail(e) { busy(false); status(e.message || 'Scan failed.', 'err'); }

  $('scanForm').addEventListener('submit', function (e) { e.preventDefault(); scanLink(); });
  $('pick').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () { scanFile(this.files[0]); this.value = ''; });

  // whole-page drag and drop
  var depth = 0;
  window.addEventListener('dragenter', function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types, 'Files') > -1) { depth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', function () { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
    var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) scanFile(f);
  });

  // ---------- rendering (always textContent; repo content is untrusted)
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var GROUPS = [['high', 'Red flags'], ['medium', 'Worth checking'], ['low', 'Minor notes'], ['info', 'For your information']];

  function render(r) {
    current = r;
    $('result').hidden = false;
    $('verdict').className = 'verdict ' + r.verdict;
    $('headline').textContent = r.headline;
    $('note').textContent = r.note;
    var ul = $('summary'); ul.textContent = '';
    (r.summary || []).forEach(function (s) { ul.append(el('li', null, s)); });

    setOut($('oHigh'), r.counts.high, r.counts.high ? 'high' : 'zero');
    setOut($('oMed'), r.counts.medium, r.counts.medium ? 'med' : 'zero');
    setOut($('oLow'), r.counts.low + r.counts.info, (r.counts.low + r.counts.info) ? '' : 'zero');
    setOut($('oFiles'), r.coverage.scanned || r.coverage.files, '');

    var src = $('src'); src.textContent = '';
    if (r.source.type === 'github') {
      var a = el('a', null, r.source.label); a.href = r.source.url; a.rel = 'noopener nofollow'; a.target = '_blank';
      src.append(a, (r.source.ref ? ' · ' + r.source.ref : '') + (r.source.sha ? ' @ ' + r.source.sha.slice(0, 7) : ''));
    } else src.append(r.source.label);
    var when = new Date(r.scannedAt);
    src.append(' · scanned ' + when.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    src.append(' · ' + r.coverage.files + ' files, ' + r.coverage.deps + ' dependencies');
    if (r.coverage.registryChecked) src.append(', ' + r.coverage.registryChecked + ' looked up on npm');

    var box = $('findings'); box.textContent = '';
    GROUPS.forEach(function (g) {
      var items = r.findings.filter(function (f) { return f.severity === g[0]; });
      if (!items.length) return;
      var sec = el('div', 'group'); sec.append(el('h3', null, g[1] + ' (' + items.length + ')'));
      items.forEach(function (f) {
        var row = el('div', 'row ' + f.severity);
        row.append(el('span', 'sev'));
        var body = el('div');
        body.append(el('div', 't', f.title));
        if (f.file) body.append(el('div', 'm', f.file + (f.line ? ':' + f.line : '')));
        body.append(el('p', 'x', f.explain));
        if (f.snippet) body.append(el('code', 'snip', f.snippet));
        if (f.more) body.append(el('div', 'more', '+' + f.more + ' more like this in the same file'));
        row.append(body); sec.append(row);
      });
      box.append(sec);
    });
    if (r.truncatedFindings) box.append(el('p', 'more', '+' + r.truncatedFindings + ' more findings not shown.'));
  }

  $('copy').addEventListener('click', function () {
    if (!current) return;
    var link = location.origin + '/r/' + current.id, btn = this;
    var ok = function () { btn.textContent = 'Link copied'; setTimeout(function () { btn.textContent = 'Copy link to this result'; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(ok, function () { prompt('Copy this link', link); });
    else prompt('Copy this link', link);
  });
  $('again').addEventListener('click', function () {
    $('result').hidden = true; current = null; $('repo').value = ''; liveHint();
    try { history.pushState({}, '', '/'); } catch (e) {}
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); $('repo').focus();
  });

  // ---------- shared result links
  function loadFromPath() {
    var m = location.pathname.match(/^\/r\/([A-Za-z0-9]{6,16})$/);
    if (!m) { $('result').hidden = true; return; }
    status('Loading result…', 'busy');
    fetch('/api/r/' + m[1]).then(function (res) { return res.json(); }).then(function (r) {
      if (r.error) throw new Error(r.error);
      status(''); render(r);
    }).catch(function (e) { status(e.message, 'err'); });
  }
  window.addEventListener('popstate', loadFromPath);
  loadFromPath();
})();

// Faint rain of the tricks the scanner looks for, behind the page (moonjelly style, as on Desk).
(function () {
  'use strict';
  var cv = document.getElementById('rain'); if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d');
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var W = 0, H = 0, cols = [], colW = 34, size = 13, line = 17, last = 0, raf = 0;
  var FLAGS = ['postinstall', 'eval(', 'folderOpen', 'base64', 'exec(', 'curl|sh', 'new Function', 'id_rsa', 'Login Data', '.woff2', 'preinstall', 'webhook', 'child_process'];
  var INK = ['npm i', '{ }', 'src/', 'index.js', 'README', 'test', 'git', 'main', '=>', 'const', 'import', 'package.json'];
  function r(a, b) { return a + Math.random() * (b - a); }
  function token() {
    var k = Math.random();
    if (k < .4) return { t: FLAGS[(Math.random() * FLAGS.length) | 0], c: Math.random() < .5 ? 'flag' : 'warn' };
    if (k < .55) return { t: '_0x' + ((Math.random() * 0xffff) | 0).toString(16), c: 'warn' };
    return { t: INK[(Math.random() * INK.length) | 0], c: 'ink' };
  }
  function colors() {
    var cs = getComputedStyle(document.documentElement);
    var a = parseFloat(cs.getPropertyValue('--rain-a')) || .08;
    return { ink: 'rgba(' + cs.getPropertyValue('--rain-ink').trim() + ',' + a + ')',
             flag: 'rgba(' + cs.getPropertyValue('--rain-flag').trim() + ',' + (a * 1.6) + ')',
             warn: 'rgba(' + cs.getPropertyValue('--rain-warn').trim() + ',' + (a * 1.4) + ')' };
  }
  var C = colors();
  function newDrop(col, start) {
    var tk = token(); col.text = tk.t; col.kind = tk.c;
    col.y = start ? r(-H, H) : r(-260, -40); col.speed = r(14, 34);
  }
  function resize() {
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    colW = W < 520 ? 30 : 34;
    var n = Math.ceil(W / colW); cols = [];
    for (var i = 0; i < n; i++) { var c = { x: i * colW + colW / 2 }; newDrop(c, true); if (Math.random() < .3) c.off = true; cols.push(c); }
  }
  function draw(dt) {
    ctx.clearRect(0, 0, W, H);
    ctx.font = '200 ' + size + "px 'Lexend', ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (var i = 0; i < cols.length; i++) {
      var col = cols[i]; if (col.off) continue;
      col.y += col.speed * dt;
      if (col.y > H + 20) { newDrop(col, false); if (Math.random() < .15) col.off = true; continue; }
      ctx.fillStyle = C[col.kind];
      for (var j = 0; j < col.text.length; j++) {
        var yy = col.y + j * line; if (yy < -line || yy > H) continue;
        ctx.globalAlpha = .35 + .65 * (j + 1) / col.text.length;
        ctx.fillText(col.text[j], col.x, yy);
      }
    }
    ctx.globalAlpha = 1;
    if (Math.random() < .02) { var k = (Math.random() * cols.length) | 0; if (cols[k].off) { cols[k].off = false; newDrop(cols[k], false); } }
  }
  function loop(ts) { var dt = last ? Math.min(.1, (ts - last) / 1000) : 0; last = ts; draw(dt); raf = requestAnimationFrame(loop); }
  function start() { if (reduced) { draw(0); return; } cancelAnimationFrame(raf); last = 0; raf = requestAnimationFrame(loop); }
  window.addEventListener('resize', function () { resize(); if (reduced) draw(0); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) cancelAnimationFrame(raf); else start(); });
  resize();
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(start);
})();
