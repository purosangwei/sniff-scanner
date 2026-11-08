'use strict';
const crypto = require('crypto');
const { readTarGz, readZip } = require('./archive');
const { scanFiles } = require('./scanner');
const { parseRepoUrl, fetchMeta, fetchTarball, metaFindings } = require('./github');

const SEV_ORDER = { high: 0, medium: 1, low: 2, info: 3 };

function newId() { return crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, '').slice(0, 10) || crypto.randomUUID().slice(0, 10); }

function verdictOf(counts) {
  if (counts.high) return 'red';
  if (counts.medium) return 'amber';
  return 'clear';
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }

// Plain-English lines built only from the findings (no AI, no guessing).
function summarise(findings, verdict) {
  const lines = [];
  const hook = findings.find(f => f.rule === 'install-hook' && f.severity !== 'low');
  const chain = findings.find(f => f.rule === 'chain' && f.when === 'install');
  const folder = findings.find(f => f.rule === 'vscode-folderopen');
  if (folder) lines.push(`Opening this folder in VS Code would run ${folder.command ? `"${folder.command}"` : 'a command'} straight away, without you typing anything.`);
  if (hook) lines.push(`Typing npm install would automatically run "${hook.command}"${chain ? `, and that file has ${plural(chain.redCount, 'red flag')} of its own.` : '.'}`);
  const secrets = [...new Set(findings.filter(f => f.rule === 'secret-paths').map(f => f.target))];
  if (secrets.length) lines.push(`The code looks for ${secrets.slice(0, 3).join(', ')}${secrets.length > 3 ? ' and more' : ''}.`);
  const net = findings.find(f => f.rule === 'raw-ip' && f.severity === 'high') || findings.find(f => f.rule === 'webhook-exfil') || findings.find(f => f.rule === 'paste-site' && f.severity === 'high');
  if (net) lines.push(net.rule === 'raw-ip' ? `It talks to a bare IP address (${net.ip}).` : net.rule === 'webhook-exfil' ? 'It can send data to a chat bot (a common way to collect stolen files).' : 'It pulls content from a paste site.');
  if (!lines.length) {
    const top = findings.filter(f => f.severity === 'high' || f.severity === 'medium').slice(0, 2);
    top.forEach(f => lines.push(f.title + (f.file ? ` (${f.file})` : '') + '.'));
  }
  if (!lines.length && verdict === 'clear') lines.push("None of the tricks we check for turned up.");
  return lines.slice(0, 4);
}

function finish({ source, meta, files, scan, extra = [] }) {
  const findings = [...scan.findings, ...extra].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.rule === 'chain' ? -1 : b.rule === 'chain' ? 1 : 0));
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  findings.forEach(f => counts[f.severity]++);
  const verdict = verdictOf(counts);
  return {
    id: newId(),
    version: 1,
    scannedAt: new Date().toISOString(),
    source, meta: meta || null,
    verdict, counts,
    headline: verdict === 'red' ? "Red flags found. Don't run this."
      : verdict === 'amber' ? 'A few things worth checking before you run it.'
      : 'No known red flags found.',
    note: verdict === 'clear' ? "That's a good sign, not a guarantee. If you don't know the company, open it in a VM anyway."
      : verdict === 'amber' ? "None of these are proof of malware on their own. Read the flagged files, and if you're unsure, only open it in a VM."
      : 'If a recruiter sent you this, stop here. Do not install it, open it in VS Code or run it on a machine with wallets or work logins.',
    summary: summarise(findings, verdict),
    coverage: Object.assign({}, scan.coverage, { files: files.length }),
    findings: findings.slice(0, 200),
    truncatedFindings: Math.max(0, findings.length - 200),
  };
}

async function scanGithub(input, opts = {}) {
  const parsed = parseRepoUrl(input);
  if (!parsed) { const e = new Error("That doesn't look like a GitHub repo link. It should look like github.com/owner/repo."); e.userFacing = true; throw e; }
  const meta = await fetchMeta(parsed);
  const tgz = await fetchTarball(parsed, meta);
  const files = readTarGz(tgz);
  for (const f of files) f.path = f.path.split('/').slice(1).join('/'); // drop "owner-repo-sha/"
  const scan = await scanFiles(files.filter(f => f.path), { network: opts.network !== false });
  return finish({
    source: { type: 'github', label: meta.fullName, url: meta.htmlUrl, ref: parsed.ref || meta.defaultBranch, sha: meta.headSha || null },
    meta: { createdAt: meta.createdAt, pushedAt: meta.pushedAt, stars: meta.stars, commits: meta.commits ?? null, owner: meta.ownerLogin, ownerCreatedAt: meta.ownerCreatedAt || null, description: meta.description },
    files, scan, extra: metaFindings(meta),
  });
}

async function scanArchive(buf, name, opts = {}) {
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const isGz = buf[0] === 0x1f && buf[1] === 0x8b;
  if (!isZip && !isGz) { const e = new Error('Please drop a .zip (or .tar.gz) of the project.'); e.userFacing = true; throw e; }
  const files = isZip ? readZip(buf, opts.limits) : require('./archive').stripCommonRoot(readTarGz(buf, opts.limits));
  const scan = await scanFiles(files.filter(f => f.path), { network: opts.network !== false, asDependency: !!opts.asDependency });
  return finish({ source: { type: 'upload', label: String(name || 'upload.zip').slice(0, 120) }, files, scan });
}

module.exports = { scanGithub, scanArchive, finish, summarise };
