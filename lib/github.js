'use strict';
// Downloads a GitHub repo as a tarball straight into memory.
// No git clone (so no hooks, submodules, LFS or filters), no install, no execution.
const { ArchiveError } = require('./archive');

const MAX_DOWNLOAD = 60 * 1024 * 1024;

function parseRepoUrl(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  s = s.replace(/^git\+/, '').replace(/^git@github\.com:/i, 'https://github.com/');
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) s = 'https://github.com/' + s;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[\w.-]{1,100}$/.test(owner) || !/^[\w.-]{1,100}$/.test(repo)) return null;
  let ref = null;
  if ((parts[2] === 'tree' || parts[2] === 'commit' || parts[2] === 'blob') && parts[3]) ref = decodeURIComponent(parts.slice(3).join('/'));
  if (parts[2] === 'blob' && ref) ref = ref.split('/')[0];
  return { owner, repo, ref };
}

function ghHeaders() {
  const h = { 'user-agent': 'sniff-scanner', accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  return h;
}

async function ghJson(path, timeout = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch('https://api.github.com' + path, { headers: ghHeaders(), signal: ctrl.signal });
    return { status: res.status, headers: res.headers, body: res.ok ? await res.json() : null };
  } finally { clearTimeout(t); }
}

async function fetchMeta({ owner, repo }) {
  const r = await ghJson(`/repos/${owner}/${repo}`);
  if (r.status === 404) throw new ArchiveError("Couldn't find that repo. It may be private, deleted or mistyped. For private tests, download the zip and drop it here instead.");
  if (r.status === 403 || r.status === 429) throw new ArchiveError('GitHub is rate-limiting us right now. Try again in a few minutes, or drop the zip instead.');
  if (!r.body) throw new ArchiveError("GitHub didn't answer. Try again, or drop the zip instead.");
  const b = r.body;
  const meta = {
    fullName: b.full_name, htmlUrl: b.html_url, defaultBranch: b.default_branch,
    createdAt: b.created_at, pushedAt: b.pushed_at, sizeKb: b.size, stars: b.stargazers_count,
    forks: b.forks_count, fork: b.fork, archived: b.archived, description: b.description || '',
    ownerType: b.owner && b.owner.type, ownerLogin: b.owner && b.owner.login,
  };
  // extra signals, best effort
  const [commits, owner_] = await Promise.allSettled([
    ghJson(`/repos/${owner}/${repo}/commits?per_page=1`),
    ghJson(`/users/${encodeURIComponent(owner)}`),
  ]);
  if (commits.status === 'fulfilled' && commits.value.status === 200) {
    const link = commits.value.headers.get('link') || '';
    const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
    meta.commits = m ? +m[1] : (Array.isArray(commits.value.body) ? commits.value.body.length : null);
    const c = Array.isArray(commits.value.body) && commits.value.body[0];
    if (c) meta.headSha = c.sha;
  }
  if (owner_.status === 'fulfilled' && owner_.value.body) {
    meta.ownerCreatedAt = owner_.value.body.created_at;
    meta.ownerRepos = owner_.value.body.public_repos;
    meta.ownerFollowers = owner_.value.body.followers;
  }
  return meta;
}

async function fetchTarball({ owner, repo, ref }, meta) {
  if (meta && meta.sizeKb > 200 * 1024) throw new ArchiveError('That repo is too big to scan here (over 200 MB). Coding tests are usually tiny, which is worth noticing too.');
  const which = ref || (meta && meta.defaultBranch) || 'HEAD';
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${encodeURIComponent(which).replace(/%2F/g, '/')}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'sniff-scanner' }, signal: ctrl.signal, redirect: 'follow' });
    if (res.status === 404) throw new ArchiveError(`Couldn't download branch "${which}". Check the link.`);
    if (!res.ok) throw new ArchiveError(`GitHub download failed (${res.status}). Try again or drop the zip instead.`);
    const chunks = []; let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > MAX_DOWNLOAD) { ctrl.abort(); throw new ArchiveError('That repo is too big to scan here.'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (e) {
    if (e.name === 'AbortError') throw new ArchiveError('The download took too long. Try again, or drop the zip instead.');
    throw e;
  } finally { clearTimeout(t); }
}

// Repo-level warning signs. Pure function so it can be tested offline.
function metaFindings(meta, now = Date.now()) {
  const out = [];
  if (!meta) return out;
  const days = d => d ? Math.floor((now - Date.parse(d)) / 86400000) : null;
  const age = days(meta.createdAt);
  const ownerAge = days(meta.ownerCreatedAt);
  const ago = n => n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
  if (age !== null && age <= 30) out.push({ rule: 'repo-new', severity: age <= 7 ? 'medium' : 'low', file: '', line: 0, snippet: meta.createdAt,
    title: `Repo was created ${ago(age)}`,
    explain: 'Malicious repos are usually set up just before they are sent out. Not proof of anything on its own, but real projects tend to have some history.' });
  if (ownerAge !== null && ownerAge <= 90) out.push({ rule: 'owner-new', severity: ownerAge <= 30 ? 'medium' : 'low', file: '', line: 0, snippet: `${meta.ownerLogin}, joined ${meta.ownerCreatedAt}`,
    title: `The GitHub account is ${ownerAge <= 1 ? 'brand new' : ownerAge + ' days old'}`,
    explain: `"${meta.ownerLogin}" joined GitHub recently. Attackers make fresh accounts for each campaign. Check the company's real website links to this account.` });
  if (meta.commits === 1) out.push({ rule: 'single-commit', severity: 'low', file: '', line: 0, snippet: '1 commit',
    title: 'Whole project was uploaded in a single commit',
    explain: "There's no history, so you can't see who wrote what or when. Common in copied or freshly planted repos." });
  if (meta.ownerType === 'User' && meta.ownerRepos !== undefined && meta.ownerRepos <= 2 && ownerAge !== null && ownerAge <= 180) {
    out.push({ rule: 'owner-thin', severity: 'low', file: '', line: 0, snippet: `${meta.ownerRepos} public repos`,
      title: 'Posted from a personal account with almost nothing else on it',
      explain: 'Real companies usually share tests from an organisation account with a history. A near-empty personal account is a weak warning sign.' });
  }
  return out;
}

module.exports = { parseRepoUrl, fetchMeta, fetchTarball, metaFindings };
