(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var current = null;

  // ---------- glow follows the pointer
  // (Desk's motion.js makes the glow trail behind the pointer when it's loaded)
  document.addEventListener('pointermove', function (e) {
    var c = e.target.closest && e.target.closest('.gf-cell'); if (!c) return;
    var r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (window.__glowTo) window.__glowTo(c, x, y);
    else { c.style.setProperty('--mx', x + 'px'); c.style.setProperty('--my', y + 'px'); }
  }, { passive: true });

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
  // The light reacts to scans only on the demo link until it's approved for everyone.
  // The light reacts to every scan now; ?demo=light only adds the button bar for showing it off.
  var DEMO_LIGHT = true;
  function mood(m) {
    if (!DEMO_LIGHT) return;
    if (window.__sunMood) window.__sunMood(m);
    // the words take on the light's colour too (see [data-mood] in style.css)
    document.documentElement.dataset.mood = m;
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
    busy(true); mood('scan'); status('Downloading and reading the files. Usually a few seconds.', 'busy');
    post('/api/scan', JSON.stringify({ url: v }), { 'content-type': 'application/json' })
      .then(done).catch(fail);
  }
  function scanFile(f) {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { status('That file is over 25 MB. Most repos are much smaller.', 'err'); return; }
    if (!/\.(zip|tgz|tar\.gz|gz)$/i.test(f.name)) { status('Drop a .zip of the project.', 'err'); return; }
    busy(true); mood('scan'); status('Reading ' + f.name + '…', 'busy');
    post('/api/upload', f, { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) })
      .then(done).catch(fail);
  }
  function done(r) {
    busy(false); status('');
    render(r);
    try { history.pushState({ id: r.id }, '', '/r/' + r.id); } catch (e) {}
    $('result').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }
  function fail(e) { busy(false); mood('idle'); status(e.message || 'Scan failed.', 'err'); }

  $('scanForm').addEventListener('submit', function (e) { e.preventDefault(); scanLink(); });
  // "The tricks" list types itself out, one trick at a time, the first time it scrolls into view
  (function () {
    var list = document.querySelector('.checks'); if (!list || reduced || !('IntersectionObserver' in window)) return;
    var items = [].slice.call(list.querySelectorAll('li')).map(function (li) {
      var b = li.querySelector('b'), sp = li.querySelector('span');
      var t = b.textContent; li.setAttribute('aria-label', t + '. ' + (sp ? sp.textContent : ''));
      b.textContent = '\u00a0'; if (sp) sp.classList.add('wait');
      return { b: b, sp: sp, t: t };
    });
    var io = new IntersectionObserver(function (es) {
      if (!es.some(function (e) { return e.isIntersecting; })) return;
      io.disconnect();
      (async function () {
        for (var k = 0; k < items.length; k++) {
          var it = items[k]; it.b.textContent = ''; it.b.classList.add('typing');
          for (var i = 1; i <= it.t.length; i++) { it.b.textContent = it.t.slice(0, i); await new Promise(function (ok) { setTimeout(ok, 22); }); }
          it.b.classList.remove('typing');
          if (it.sp) { it.sp.classList.remove('wait'); it.sp.classList.add('fade'); }
          await new Promise(function (ok) { setTimeout(ok, 120); });
        }
      })();
    }, { threshold: 0.25 });
    io.observe(list);
  })();

  // ---------- first visit: an 8-second muted teaser, then the page. Once per visitor, always skippable.
  (function () {
    var box = $('intro'), v = $('introVid'), seen = false;
    try { seen = localStorage.getItem('sniff-intro') === '1'; } catch (e) {}
    if (seen || reduced || location.pathname !== '/') return;
    function done() {
      try { localStorage.setItem('sniff-intro', '1'); } catch (e) {}
      box.classList.add('out'); setTimeout(function () { box.hidden = true; }, 700);
    }
    box.hidden = false;
    $('introSkip').addEventListener('click', done);
    v.addEventListener('ended', done);
    v.addEventListener('error', done);
    var p = v.play(); if (p && p.catch) p.catch(done);   // if the browser won't autoplay, just show the page
    setTimeout(function () { if (!box.hidden && v.paused) done(); }, 2500);
  })();

  // ---------- the full film, with sound, only when someone asks for it
  (function () {
    var film = $('film'), v = $('filmVid'), last = null;
    function open() { last = document.activeElement; film.hidden = false; requestAnimationFrame(function () { film.classList.add('in'); }); v.currentTime = 0; var p = v.play(); if (p && p.catch) p.catch(function () {}); $('filmClose').focus(); }
    function close() { v.pause(); film.classList.remove('in'); setTimeout(function () { film.hidden = true; }, 300); if (last) last.focus(); }
    $('watch').addEventListener('click', open);
    $('filmClose').addEventListener('click', close);
    film.addEventListener('click', function (e) { if (e.target === film) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !film.hidden) close(); });
  })();

  // sample repos: fill the box and scan straight away
  document.querySelectorAll('.sample').forEach(function (b) {
    b.addEventListener('click', function () {
      var input = $('repo'); input.value = b.dataset.repo;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      scanLink();
    });
  });
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
    mood(r.verdict);
    $('result').hidden = false;
    $('verdict').className = 'verdict ' + r.verdict;
    $('headline').textContent = r.headline;
    var NOTES = {
      clear: "That's a good sign, not a guarantee. If you don't know who made it, open it in a VM anyway.",
      amber: "None of these are proof of malware on their own. Read the flagged files, and if you're unsure, only open it in a VM.",
      red: "Stop here. Don't install it, open it in VS Code or run it on a machine with wallets or work logins."
    };
    $('note').textContent = NOTES[r.verdict] || r.note;
    var ul = $('summary'); ul.textContent = '';
    (r.summary || []).forEach(function (s) { ul.append(el('li', null, s)); });

    setOut($('oHigh'), r.counts.high, r.counts.high ? 'high' : 'zero');
    setOut($('oMed'), r.counts.medium, r.counts.medium ? 'med' : 'zero');
    setOut($('oLow'), r.counts.low + r.counts.info, (r.counts.low + r.counts.info) ? '' : 'zero');
    setOut($('oFiles'), r.coverage.scanned || r.coverage.files, '');

    // what was scanned, as a few labelled facts instead of one long line
    var src = $('src'); src.textContent = '';
    function fact(label, value) { var d = el('div', 'fact'); d.append(el('dt', null, label)); var dd = el('dd'); dd.append(value); d.append(dd); src.append(d); }
    if (r.source.type === 'github') {
      var a = el('a', null, r.source.label); a.href = r.source.url; a.rel = 'noopener nofollow'; a.target = '_blank';
      fact('Repo', a);
      if (r.source.ref || r.source.sha) fact('Version', (r.source.ref || '') + (r.source.sha ? (r.source.ref ? ' · ' : '') + r.source.sha.slice(0, 7) : ''));
    } else fact('File', r.source.label);
    var when = new Date(r.scannedAt);
    fact('Scanned', when.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
    var cov = r.coverage.files + ' files · ' + r.coverage.deps + (r.coverage.deps === 1 ? ' dependency' : ' dependencies');
    if (r.coverage.registryChecked) cov += ' · ' + r.coverage.registryChecked + ' checked on npm';
    fact('Checked', cov);

    closeTile();
    // start folded: verdict and counts only, details one click away
    var total = r.findings.length;
    setDetails(false);
    $('toggleDetails').hidden = !total && !(r.summary || []).length;
    $('toggleDetails').dataset.n = total;
    $('toggleLbl').textContent = total ? 'Show the details (' + total + ')' : 'Show the details';
    var box = $('findings'); box.textContent = '';
    GROUPS.forEach(function (g) {
      var items = r.findings.filter(function (f) { return f.severity === g[0]; });
      if (!items.length) return;
      var sec = el('div', 'group'); sec.append(el('h3', null, g[1] + ' (' + items.length + ')'));
      groupByTitle(items).forEach(function (g) {
        var b = buildRow(g, 'row'); b.t.textContent = b.title; b.rest.forEach(function (n) { b.body.append(n); }); sec.append(b.row);
      });
      box.append(sec);
    });
    if (r.truncatedFindings) box.append(el('p', 'more', '+' + r.truncatedFindings + ' more findings not shown.'));
  }

  // ---------- compact rows: the same finding in several files becomes one row,
  // explained once, with one short line per file
  function groupByTitle(items) {
    var out = [], at = {};
    items.forEach(function (f) {
      var key = f.severity + '|' + f.title;
      if (!(key in at)) { at[key] = out.length; out.push([]); }
      out[at[key]].push(f);
    });
    return out;
  }
  function stripFile(f) { return f.file ? f.explain.split(f.file).join('this file') : f.explain; }
  function buildRow(g, cls) {
    var f0 = g[0], same = g.every(function (f) { return stripFile(f) === stripFile(f0); });
    var row = el('div', cls + ' ' + f0.severity); row.append(el('span', 'sev'));
    var body = el('div'), head = el('div', 'head'), t = el('span', 't');
    head.append(t); if (g.length > 1) head.append(el('span', 'cnt', g.length + ' files'));
    body.append(head); row.append(body);
    var rest = [];
    if (same) rest.push(el('p', 'x', g.length > 1 ? stripFile(f0) : f0.explain));
    var locs = el('ul', 'locs');
    g.forEach(function (f) {
      if (!f.file && !f.snippet && same) return;
      var li = el('li', 'loc');
      if (f.file) li.append(el('span', 'where', f.file + (f.line ? ':' + f.line : '')));
      var snip = f.snippet ? String(f.snippet) : '';
      if (snip && snip.length <= 16 && !/[(){};=]/.test(snip)) li.append(el('span', 'meta', snip));   // sizes and short notes sit inline
      if (f.more) li.append(el('span', 'meta', '+' + f.more + ' more here'));
      if (!same) li.append(el('span', 'lx', f.explain));
      if (snip && !(snip.length <= 16 && !/[(){};=]/.test(snip))) {
        var c = el('code', 'snip1', snip); li.append(c);
        c.title = 'Click to see the whole line';
        c.addEventListener('click', function () { c.classList.toggle('open'); });
      }
      locs.append(li);
    });
    if (locs.childNodes.length) rest.push(locs);
    return { row: row, body: body, t: t, title: f0.title, rest: rest };
  }

  // ---------- count tiles: click one to type out just that list
  var tileRun = 0, openGroup = null;
  var TILE_NAMES = { high: 'red flags', medium: 'things worth checking', low: 'minor notes' };
  function sleep(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function typeText(node, text, run, perChar) {
    if (reduced) { node.textContent = text; return Promise.resolve(); }
    node.classList.add('typing');
    return new Promise(function (done) {
      var i = 0, step = Math.max(1, Math.ceil(text.length / 40));   // long lines type in chunks so nothing drags
      (function tick() {
        if (run !== tileRun) return done();
        i = Math.min(text.length, i + step);
        node.textContent = text.slice(0, i);
        if (i < text.length) setTimeout(tick, perChar);
        else { node.classList.remove('typing'); done(); }
      })();
    });
  }
  function closeTile() {
    tileRun++; openGroup = null;
    document.querySelectorAll('.tile').forEach(function (t) { t.setAttribute('aria-expanded', 'false'); });
    var p = $('tilePanel'); p.hidden = true; p.textContent = '';
  }
  function openTile(group) {
    var r = current; if (!r) return;
    var run = ++tileRun; openGroup = group;
    document.querySelectorAll('.tile').forEach(function (t) { t.setAttribute('aria-expanded', t.dataset.group === group ? 'true' : 'false'); });
    var p = $('tilePanel'); p.textContent = ''; p.hidden = false; p.className = 'tile-panel ' + group;
    if (window.__lenis && window.__lenis.resize) window.__lenis.resize();
    if (group === 'files') return typeFiles(r, p, run);
    var items = r.findings.filter(function (f) { return group === 'low' ? (f.severity === 'low' || f.severity === 'info') : f.severity === group; });
    if (!items.length) { var none = el('p', 'tile-none'); p.append(none); return typeText(none, 'No ' + TILE_NAMES[group] + ' in this scan.', run, 22); }
    (async function () {
      var groups = groupByTitle(items);
      for (var k = 0; k < groups.length; k++) {
        if (run !== tileRun) return;
        var b = buildRow(groups[k], 'gf-cell out row typed'); p.append(b.row);
        await typeText(b.t, b.title, run, 16);
        if (run !== tileRun) return;
        b.rest.forEach(function (n) { n.classList.add('fade'); b.body.append(n); });
        if (!reduced) await sleep(k < 6 ? 140 : 40);
      }
    })();
  }
  function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
  function typeFiles(r, p, run) {
    var list = r.fileList;
    if (!list) { var old = el('p', 'tile-none'); p.append(old); return typeText(old, 'This result was saved before file lists were kept. Scan it again to see every file.', run, 18); }
    var ul = el('ul', 'filelist'); p.append(ul);
    (async function () {
      for (var k = 0; k < list.length; k++) {
        if (run !== tileRun) return;
        var f = list[k], li = el('li', 'gf-cell out' + (f.w ? ' has ' + f.w : ''));
        var dot = el('span', 'fdot'); var name = el('span', 'fname'); var size = el('span', 'fsize', fmtSize(f.s));
        li.append(dot, name, size); ul.append(li);
        if (k < 60) await typeText(name, f.p, run, 9); else name.textContent = f.p;
      }
      if (r.coverage.files > list.length && run === tileRun) p.append(el('p', 'more', '+' + (r.coverage.files - list.length) + ' more files not listed.'));
    })();
  }
  document.querySelectorAll('.tile').forEach(function (t) {
    t.addEventListener('click', function () { if (openGroup === t.dataset.group) closeTile(); else openTile(t.dataset.group); });
  });

  function setDetails(open) {
    $('details').hidden = !open;
    $('toggleDetails').setAttribute('aria-expanded', open ? 'true' : 'false');
    var n = +$('toggleDetails').dataset.n || 0;
    $('toggleLbl').textContent = open ? 'Hide the details' : (n ? 'Show the details (' + n + ')' : 'Show the details');
  }
  $('toggleDetails').addEventListener('click', function () {
    var open = $('details').hidden;
    setDetails(open);
    if (open && window.__lenis) window.__lenis.resize && window.__lenis.resize();
  });

  $('copy').addEventListener('click', function () {
    if (!current) return;
    var link = location.origin + '/r/' + current.id, btn = this;
    var ok = function () { btn.textContent = 'Link copied'; setTimeout(function () { btn.textContent = 'Copy link to this result'; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(ok, function () { prompt('Copy this link', link); });
    else prompt('Copy this link', link);
  });
  $('again').addEventListener('click', function () {
    $('result').hidden = true; current = null; mood('idle'); $('repo').value = ''; liveHint();
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

  // ---------- demo of the light (only with ?demo=light)
  if (/[?&]demo=light/.test(location.search)) {
    var bar = el('div', 'demo-bar');
    bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Light demo');
    bar.append(el('span', 'demo-lbl', 'Light demo'));
    [['scan', 'Scanning'], ['red', 'Red flags'], ['amber', 'Worth checking'], ['clear', 'No known red flags'], ['idle', 'Resting']].forEach(function (b) {
      var x = el('button', 'demo-b', b[1]); x.type = 'button';
      x.addEventListener('click', function () {
        bar.querySelectorAll('button').forEach(function (o) { o.setAttribute('aria-pressed', o === x ? 'true' : 'false'); });
        mood(b[0]);
      });
      bar.append(x);
    });
    document.body.append(bar);
  }
})();
