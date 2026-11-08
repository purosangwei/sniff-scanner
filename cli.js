#!/usr/bin/env node
'use strict';
// Command-line $SNIFF: scan a folder, a .zip/.tgz, a GitHub repo or an npm package
// before installing or running it. Like the website, it only reads files: nothing is
// installed, imported or executed, and downloads stay in memory.
//
//   node cli.js ./some-folder
//   node cli.js archive.zip
//   node cli.js github.com/owner/repo
//   node cli.js npm:left-pad            (or npm:left-pad@1.3.0)
//   add --json for machine-readable output, --offline to skip npm lookups
//
// Exit code: 0 = no known red flags, 1 = worth checking, 2 = red flags, 3 = could not scan.
const fs = require('fs');
const path = require('path');
const { scanGithub, scanArchive, finish } = require('./lib/report');
const { scanFiles } = require('./lib/scanner');
const { readTarGz, stripCommonRoot, DEFAULT_LIMITS } = require('./lib/archive');

const args = process.argv.slice(2);
const json = args.includes('--json');
const offline = args.includes('--offline');
const target = args.find(a => !a.startsWith('--'));

function readFolder(root) {
  const files = [];
  let total = 0;
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git') continue;
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) { files.push({ path: rel, rawPath: rel, kind: 'symlink', linkTarget: fs.readlinkSync(full), size: 0, data: Buffer.alloc(0) }); continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!st.isFile()) continue;
      if (files.length >= DEFAULT_LIMITS.maxFiles) throw new Error(`More than ${DEFAULT_LIMITS.maxFiles} files; point it at a smaller folder.`);
      const fd = fs.openSync(full, 'r');
      const len = Math.min(st.size, DEFAULT_LIMITS.maxFile);
      const data = Buffer.alloc(len);
      fs.readSync(fd, data, 0, len, 0);
      fs.closeSync(fd);
      total += len;
      files.push({ path: rel, rawPath: rel, kind: 'file', size: st.size, data, truncated: st.size > len });
    }
  })(root);
  return files;
}

async function fetchNpm(spec) {
  const m = spec.match(/^(@?[^@]+)(?:@(.+))?$/);
  if (!m) throw new Error('Use npm:name or npm:name@version');
  const name = m[1], want = m[2] || 'latest';
  const res = await fetch('https://registry.npmjs.org/' + name.replace('/', '%2f'), { headers: { accept: 'application/json' } });
  if (res.status === 404) throw new Error(`"${name}" doesn't exist on npm.`);
  const doc = await res.json();
  const version = (doc['dist-tags'] && doc['dist-tags'][want]) || want;
  const v = doc.versions && doc.versions[version];
  if (!v) throw new Error(`No version "${want}" of ${name}.`);
  const tgz = Buffer.from(await (await fetch(v.dist.tarball)).arrayBuffer());
  return { buf: tgz, label: `${name}@${version}`, published: doc.time && doc.time[version] };
}

function print(r) {
  const dot = { red: '🔴', amber: '🟠', clear: '⚪' }[r.verdict];
  const out = [];
  out.push(`${dot} ${r.headline}  (${r.source.label})`);
  out.push(`   ${r.coverage.files} files, ${r.coverage.deps} dependencies` + (r.coverage.registryChecked ? `, ${r.coverage.registryChecked} looked up on npm` : ''));
  r.summary.forEach(s => out.push('   • ' + s));
  for (const sev of ['high', 'medium', 'low']) {
    const items = r.findings.filter(f => f.severity === sev);
    if (!items.length) continue;
    out.push('', { high: 'RED FLAGS', medium: 'WORTH CHECKING', low: 'MINOR' }[sev] + ` (${items.length})`);
    for (const f of items) {
      out.push(`  - ${f.title}${f.file ? `  [${f.file}${f.line ? ':' + f.line : ''}]` : ''}`);
      if (f.snippet && sev !== 'low') out.push(`      ${String(f.snippet).slice(0, 160)}`);
    }
  }
  out.push('', r.note);
  console.log(out.join('\n'));
}

(async () => {
  if (!target) { console.error('Usage: node cli.js <folder | file.zip | file.tgz | github.com/owner/repo | npm:package[@version]> [--json] [--offline]'); process.exit(3); }
  const opts = { network: !offline };
  let report;
  if (target.startsWith('npm:')) {
    const p = await fetchNpm(target.slice(4));
    report = await scanArchive(p.buf, p.label, Object.assign({}, opts, { asDependency: true, limits: { maxFiles: 40000, maxTotal: 400 * 1024 * 1024 } }));
    if (p.published) report.source.published = p.published;
  } else if (/github\.com\/|^[\w.-]+\/[\w.-]+$/.test(target) && !fs.existsSync(target)) {
    try { report = await scanGithub(target, opts); }
    catch (e) {
      // GitHub unreachable from here (some sandboxes block it): ask the live $SNIFF server instead.
      const api = process.env.SNIFF_API || 'https://sniff-scanner.onrender.com';
      const res = await fetch(api + '/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: target }) });
      const j = await res.json().catch(() => ({ error: 'bad reply' }));
      if (j.error) throw new Error(e.message + ' / via ' + api + ': ' + j.error);
      report = j;
    }
  } else if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    const files = readFolder(path.resolve(target));
    report = finish({ source: { type: 'folder', label: target }, files, scan: await scanFiles(files, opts) });
  } else if (fs.existsSync(target)) {
    report = await scanArchive(fs.readFileSync(target), path.basename(target), opts);
  } else {
    throw new Error(`Can't find "${target}".`);
  }
  if (json) console.log(JSON.stringify(report, null, 2)); else print(report);
  process.exit({ clear: 0, amber: 1, red: 2 }[report.verdict]);
})().catch(e => { console.error('Could not scan: ' + e.message); process.exit(3); });
