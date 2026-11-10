'use strict';
// Static rule set. Reads file contents as text and looks for the tricks used in
// fake-recruiter "coding test" attacks. Never executes, imports or installs anything.
const { NPM, PYPI, NPM_LIST, PYPI_LIST } = require('./popular');

const SEV_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
const MAX_PER_RULE_PER_FILE = 3;

const TEXT_EXT = new Set(('js mjs cjs jsx ts tsx mts cts vue svelte astro json jsonc json5 md txt yml yaml toml ini cfg conf env ' +
  'py pyw sh bash zsh fish ps1 psm1 bat cmd vbs rb php go rs java kt swift c cc cpp h hpp cs sol html htm css scss less ' +
  'xml svg lock npmrc yarnrc gitignore gitattributes editorconfig dockerfile makefile envrc').split(' '));
const CODE_EXT = new Set('js mjs cjs jsx ts tsx mts cts vue svelte astro html htm py pyw sh bash zsh ps1 psm1 bat cmd vbs rb php sol'.split(' '));
const BIN_HIGH = new Set('exe dll scr msi so dylib node sys cpl ocx pif'.split(' '));
const BIN_MED = new Set('jar class pyc pyo wasm apk app dmg pkg deb rpm bin'.split(' '));
const ARCHIVE_EXT = new Set('zip rar 7z tar gz tgz bz2 xz'.split(' '));
const DISGUISE_EXT = { png: [[0x89, 0x50, 0x4e, 0x47]], jpg: [[0xff, 0xd8]], jpeg: [[0xff, 0xd8]], gif: [[0x47, 0x49, 0x46]],
  ico: [[0, 0, 1, 0]], webp: [[0x52, 0x49, 0x46, 0x46]], woff: [[0x77, 0x4f, 0x46, 0x46]], woff2: [[0x77, 0x4f, 0x46, 0x32]],
  ttf: [[0, 1, 0, 0], [0x74, 0x72, 0x75, 0x65]], otf: [[0x4f, 0x54, 0x54, 0x4f]], mp3: [[0x49, 0x44, 0x33], [0xff, 0xfb]],
  mp4: [], pdf: [[0x25, 0x50, 0x44, 0x46]] };
const SKIP_GENERIC = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|Cargo\.lock|composer\.lock)$|\.map$|\.ipynb$/i;
const BUILT_DIR = /(^|\/)(dist|build|out|vendor|vendors|public|static|assets|lib\/vendor|third_party|\.next|coverage)\//i;

const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish'];
// When scanning a package installed from the registry, prepare/prepublish never run for the person installing it.
const DEP_HOOKS = ['preinstall', 'install', 'postinstall'];
const RUN_SCRIPTS = ['start', 'dev', 'test', 'build', 'serve', 'setup', 'preview'];
const BENIGN_HOOK = /^(npx\s+)?(husky(\s+install)?|is-ci\s*\|\|\s*husky(\s+install)?|patch-package|node-gyp rebuild|simple-git-hooks|lefthook install|svelte-kit sync|nuxt(i)? prepare|prisma generate|panda codegen|electron-builder install-app-deps|ngcc.*|tsc(\s+-b)?|tsc -p \S+|lerna bootstrap|playwright install(\s+--with-deps)?(\s+\w+)*)$/i;
const RISKY_CMD = /\b(curl|wget|powershell|pwsh|iwr|iex|invoke-webrequest|invoke-expression|certutil|bitsadmin|mshta|rundll32|regsvr32|osascript|nc|ncat|python3?\s+-c|node\s+-e|node\s+--eval|bash\s+-c|sh\s+-c|base64)\b|\|\s*(ba|z)?sh\b|npx\s+(-y\s+)?https?:|\beval\b/i;

const PRIVATE_IP = /^(127\.|10\.|0\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|255\.)/;
// Placeholder and public-DNS addresses that show up in tests and docs, not attacker servers.
const BENIGN_IP = new Set(['1.2.3.4', '4.3.2.1', '1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9', '4.4.4.4', '208.67.222.222', '208.67.220.220']);
const PASTE_HOSTS = /\b(pastebin\.com|paste\.ee|hastebin\.com|ghostbin|rentry\.(co|org)|controlc\.com|justpaste\.it|paste\.c-net\.org|transfer\.sh|file\.io|catbox\.moe|anonfiles|bashupload|0x0\.st)\b/i;
const SOFT_HOSTS = /\b(raw\.githubusercontent\.com|gist\.githubusercontent\.com|ipfs\.io\/ipfs|cloudflare-ipfs\.com|pinata\.cloud\/ipfs)\b/i;
const TUNNEL_HOSTS = /\b([a-z0-9-]+\.)?(ngrok\.io|ngrok-free\.app|ngrok\.app|trycloudflare\.com|serveo\.net|loca\.lt|localtunnel\.me|pagekite\.me|requestbin|pipedream\.net|webhook\.site|interact\.sh|oast\.\w+|burpcollaborator\.net)\b/i;
const WEBHOOK = /discord(app)?\.com\/api\/webhooks\/|api\.telegram\.org\/bot|hooks\.slack\.com\/services\//i;
const GEO_LOOKUP = /\b(api\.ipify\.org|ipinfo\.io|ip-api\.com|ifconfig\.me|icanhazip\.com|checkip\.amazonaws\.com|geolocation-db\.com)\b/i;

const SECRET_PATHS = [
  [/nkbihfbeogaeaoehlefnkodbefgpgknn/, 'the MetaMask browser wallet'],
  [/bfnaelmomeimhlpmgjnjophhpkkoljpa/, 'the Phantom browser wallet'],
  [/hnfanknocfeofbddgcijnmhnfnkdnaad/, 'the Coinbase browser wallet'],
  [/egjidjbpglichdcondbcbdnbeeppgdph/, 'the Trust browser wallet'],
  [/ibnejdfjmmkpcnlpebklmnkoeoihofec/, 'the TronLink browser wallet'],
  [/Local Extension Settings/, 'browser extension storage (where wallet extensions keep their data)'],
  [/["'`\/\\]Login Data\b/, "the browser's saved passwords"],
  [/["'`\/\\]Local State\b/, "the browser's encryption key file"],
  [/["'`\/\\]Web Data\b/, "the browser's autofill and card data"],
  [/\bCookies["'`]/, "the browser's cookies"],
  [/login\.keychain|keychain-db\b/, 'the macOS password keychain'],
  [/\.ssh[\/\\]+(id_|authorized_keys|known_hosts)|['"`]\.ssh['"`]/, 'your SSH keys'],
  [/solana[\/\\]+id\.json/, 'your Solana CLI wallet'],
  [/\bExodus[\/\\]+exodus\.wallet|\bexodus\.wallet\b/i, 'the Exodus wallet'],
  [/Electrum[\/\\]+wallets|\.electrum\b/, 'the Electrum wallet'],
  [/\bAtomic[\/\\]+Local Storage|atomic[\/\\]+leveldb/i, 'the Atomic wallet'],
  [/\bwallet\.dat\b/, 'Bitcoin Core wallet files'],
  [/\.aws[\/\\]+credentials/, 'your AWS keys'],
  [/\.config[\/\\]+gcloud|\.kube[\/\\]+config/, 'your cloud login files'],
  [/(^|[\/\\'"`~\s])\.npmrc(?![\w.-])|\.git-credentials/, 'saved npm or Git login tokens', 'home'],
  [/Telegram Desktop[\/\\]+tdata|\btdata\b['"`]/, 'your Telegram Desktop session'],
];

function ext(path) {
  const base = path.split('/').pop().toLowerCase();
  if (base === 'dockerfile' || base === 'makefile') return base;
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1) : (base.startsWith('.') ? base.slice(1) : '');
}

function looksText(buf) {
  const n = Math.min(buf.length, 8192);
  if (!n) return true;
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = buf[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) bad++;
  }
  return bad / n < 0.02;
}

function printableRatio(buf) {
  const n = Math.min(buf.length, 4096);
  if (!n) return 0;
  let ok = 0;
  for (let i = 0; i < n; i++) { const c = buf[i]; if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) ok++; }
  return ok / n;
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}
function lineOf(starts, idx) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
  return lo + 1;
}
function snippetAt(text, starts, idx, len = 0) {
  const ln = lineOf(starts, idx);
  const s = starts[ln - 1];
  const e = ln < starts.length ? starts[ln] - 1 : text.length;
  let line = text.slice(s, e);
  let col = idx - s;
  if (line.length > 180) {
    const from = Math.max(0, Math.min(col - 60, line.length - 180));
    line = (from > 0 ? '…' : '') + line.slice(from, from + 180) + (from + 180 < line.length ? '…' : '');
  }
  return { line: ln, snippet: line.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s{20,}/g, m => ` ⟨${m.length} spaces⟩ `).trim() };
}

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
function typosquatOf(name, list, set) {
  if (set.has(name) || name.length < 4) return null;
  const n = name.toLowerCase();
  for (const p of list) {
    if (p.length < 4 || p === n) continue;
    if (lev(n, p) === 1) return p;
    // react-dom vs reactdom, web3.js vs web3js
    if (n.replace(/[-_.]/g, '') === p.replace(/[-_.]/g, '') && n !== p) return p;
  }
  return null;
}

function parseJsonc(text) {
  let out = '', inStr = false, q = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) { out += c; if (c === '\\') { out += n || ''; i++; } else if (c === q) inStr = false; continue; }
    if (c === '"') { inStr = true; q = c; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// Same text with the inside of single-line strings blanked out (positions kept), so
// a word like eval sitting in a quoted test string isn't mistaken for running code.
function blankStrings(text) {
  return text.replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`/g, m => m[0] + ' '.repeat(m.length - 2) + m[m.length - 1]);
}

function short(s, n = 160) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; }

class Collector {
  constructor() { this.list = []; this.perKey = new Map(); }
  add(f) {
    const key = f.rule + '|' + (f.file || '');
    const n = (this.perKey.get(key) || 0) + 1;
    this.perKey.set(key, n);
    if (n > MAX_PER_RULE_PER_FILE) {
      const first = this.list.find(x => x.rule === f.rule && x.file === f.file);
      if (first) first.more = (first.more || 0) + 1;
      return;
    }
    this.list.push(f);
  }
}

// ---------------------------------------------------------------- package.json
function scanPackageJson(file, text, out, ctx) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { return; }
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const inNodeModules = /(^|\/)node_modules\//.test(file);

  const resolve = (cmd, depth = 0) => {
    // follow "npm run x" / "yarn x" / "pnpm x" one or two levels
    const m = String(cmd).match(/^(?:npm run|npm run-script|yarn run|yarn|pnpm run|pnpm|bun run)\s+([\w:.-]+)/);
    if (m && depth < 2 && scripts[m[1]]) return resolve(scripts[m[1]], depth + 1);
    return String(cmd);
  };
  const scriptFiles = cmd => {
    const found = [];
    const re = /\b(?:node|nodejs|bun|deno run|ts-node|tsx|python3?|sh|bash)\s+(?:--?[\w-]+\s+)*["']?(\.?\.?\/?[\w./-]+\.(?:c?m?js|ts|py|sh))/g;
    let m; while ((m = re.exec(cmd))) found.push((dir + m[1].replace(/^\.\//, '')).replace(/\/\.\//g, '/'));
    return found;
  };

  const isRootPkg = !file.includes('/');
  for (const hook of (ctx.asDependency ? DEP_HOOKS : INSTALL_HOOKS)) {
    if (typeof scripts[hook] !== 'string') continue;
    const raw = scripts[hook];
    const cmd = resolve(raw);
    const where = inNodeModules ? ' (inside a bundled node_modules package)' : '';
    const runsFiles = scriptFiles(cmd);
    runsFiles.forEach(f => ctx.installRun.add(f));
    const base = {
      rule: 'install-hook', file, line: lineOfKey(text, hook), snippet: short(`"${hook}": "${raw}"`),
      command: short(cmd, 200), hook,
    };
    if (RISKY_CMD.test(cmd)) {
      out.add(Object.assign(base, { severity: 'high', title: `Runs a download or shell command automatically on install${where}`,
        explain: `The "${hook}" script runs by itself the moment you type npm install. This one downloads or runs something from outside the project. A coding test has no reason to do that.` }));
    } else if (BENIGN_HOOK.test(cmd.trim())) {
      out.add(Object.assign(base, { severity: 'low', title: `Runs a setup command on install${where}`,
        explain: `The "${hook}" script runs automatically on npm install. This one looks like a normal setup tool, but it's still code running without you asking.` }));
    } else {
      out.add(Object.assign(base, { severity: runsFiles.length ? 'medium' : 'medium', title: `Runs project code automatically on install${where}`,
        explain: `The "${hook}" script runs by itself the moment you type npm install${runsFiles.length ? `, and it runs ${runsFiles.join(', ')}` : ''}. This is exactly how the Binance attack started: the code ran during installation. Read that file before you install anything.` }));
    }
  }
  for (const s of (ctx.asDependency ? [] : RUN_SCRIPTS)) {
    if (typeof scripts[s] !== 'string') continue;
    const cmd = resolve(scripts[s]);
    scriptFiles(cmd).forEach(f => ctx.startRun.add(f));
    if (RISKY_CMD.test(cmd) && !/^(npx\s+)?(playwright|cypress|next|vite|react-scripts)\b/.test(cmd)) {
      out.add({ rule: 'risky-script', severity: 'high', file, line: lineOfKey(text, s), snippet: short(`"${s}": "${scripts[s]}"`),
        title: `The "${s}" script downloads or runs outside code`,
        explain: `You'd run this when starting or testing the project, and it reaches outside the project (a download, a raw shell command or eval).` });
    }
  }

  if (inNodeModules) return;
  // A registry package's devDependencies are never installed for the person using it.
  const sections = ctx.asDependency ? ['dependencies', 'optionalDependencies'] : ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  if (ctx.asDependency && !isRootPkg) return;
  for (const sec of sections) {
    const deps = pkg[sec];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      ctx.deps.add(name);
      const v = String(spec);
      if (/^(git\+|git:|github:|gitlab:|bitbucket:|https?:|file:|link:)/i.test(v) || /^[\w-]+\/[\w.-]+(#.*)?$/.test(v)) {
        out.add({ rule: 'url-dependency', severity: 'medium', file, line: lineOfKey(text, name), snippet: short(`"${name}": "${v}"`),
          title: `Installs "${name}" from a link instead of npm`,
          explain: 'This package skips the npm registry and comes straight from a Git repo, a web address or a local folder. Nobody has reviewed it, and the owner can change it at any time.' });
      }
      const sq = typosquatOf(name, NPM_LIST, NPM);
      if (sq) {
        out.add({ rule: 'typosquat', severity: 'medium', file, line: lineOfKey(text, name), snippet: short(`"${name}": "${v}"`),
          title: `"${name}" is one letter off "${sq}"`,
          explain: `Fake packages often copy a popular name with one letter changed. Check this is really the package the project needs and not a lookalike of ${sq}.` });
      }
      if (!NPM.has(name)) ctx.unknownDeps.push({ name, file, line: lineOfKey(text, name) });
      ctx.osv.push({ name, eco: 'npm', spec: v, file, line: lineOfKey(text, name) });
    }
  }
}

function lineOfKey(text, key) {
  const i = text.indexOf(`"${key}"`);
  if (i < 0) return 1;
  let n = 1; for (let k = 0; k < i; k++) if (text.charCodeAt(k) === 10) n++;
  return n;
}

// --------------------------------------------------------- auto-run configs
function scanAutoRun(file, text, out, ctx) {
  const lower = file.toLowerCase();
  if (/(^|\/)\.vscode\/tasks\.json$/.test(lower)) {
    let parsed = null;
    try { parsed = parseJsonc(text); } catch { /* fall back to regex */ }
    const tasks = parsed && Array.isArray(parsed.tasks) ? parsed.tasks : [];
    let hit = false;
    for (const t of tasks) {
      if (t && t.runOptions && String(t.runOptions.runOn).toLowerCase() === 'folderopen') {
        hit = true;
        const cmd = [t.command, ...(Array.isArray(t.args) ? t.args : [])].filter(Boolean).join(' ')
          || (t.windows && t.windows.command) || (t.osx && t.osx.command) || (t.linux && t.linux.command) || '(see file)';
        const entry = { rule: 'vscode-folderopen', severity: 'high', file, line: lineOfKey(text, 'runOn'), snippet: short(`runOn: folderOpen → ${cmd}`),
          command: short(cmd, 200),
          title: 'Runs a command as soon as you open the folder in VS Code',
          _runs: (String(cmd).match(/[\w./-]+\.(?:c?m?js|ts|py|sh|woff2?|ttf|png|jpg|txt|json)\b/g) || []).map(x => x.replace(/^\.\//, '')),
          explain: "This task is set to start automatically when the folder is opened. You don't need to install or run anything for it to fire. Don't open this folder in VS Code until you've read the command." };
        const dir = file.replace(/\.vscode\/tasks\.json$/i, '');
        entry._runs.forEach(r => ctx.openRun.add(dir + r));
        delete entry._runs;
        out.add(entry);
      }
    }
    if (!hit && /"runOn"\s*:\s*"folderOpen"/i.test(text)) {
      out.add({ rule: 'vscode-folderopen', severity: 'high', file, line: lineOfKey(text, 'runOn'), snippet: 'runOn: folderOpen',
        title: 'Runs a command as soon as you open the folder in VS Code',
        explain: 'A task in this file is set to start automatically when the folder is opened. Read it before opening the folder.' });
    }
  }
  if (/(^|\/)\.vscode\/settings\.json$/.test(lower) && /"task\.allowAutomaticTasks"\s*:\s*"on"/i.test(text)) {
    out.add({ rule: 'vscode-autotasks', severity: 'high', file, line: lineOfKey(text, 'task.allowAutomaticTasks'), snippet: '"task.allowAutomaticTasks": "on"',
      title: 'Switches off the VS Code warning for auto-run tasks',
      explain: 'VS Code normally asks before running a task automatically. This setting turns that question off.' });
  }
  if (/(^|\/)\.devcontainer(\.json|\/devcontainer\.json)$/.test(lower) || /(^|\/)\.devcontainer\/[^/]*\.json$/.test(lower)) {
    const m = text.match(/"initializeCommand"\s*:\s*("(?:[^"\\]|\\.)*"|\[[^\]]*\])/);
    if (m) out.add({ rule: 'devcontainer-init', severity: 'high', file, line: lineOfKey(text, 'initializeCommand'), snippet: short(m[0]),
      title: 'Runs a command on your own machine when the dev container starts',
      explain: '"initializeCommand" runs on your computer, not inside the container, before anything is isolated.' });
    for (const k of ['postCreateCommand', 'postStartCommand', 'postAttachCommand', 'onCreateCommand']) {
      const r = new RegExp(`"${k}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|\\[[^\\]]*\\])`).exec(text);
      if (r && RISKY_CMD.test(r[1])) out.add({ rule: 'devcontainer-cmd', severity: 'medium', file, line: lineOfKey(text, k), snippet: short(r[0]),
        title: `Dev container "${k}" downloads or runs outside code`,
        explain: 'This runs automatically when the container is set up. It runs inside the container, which limits the damage, but check what it fetches.' });
    }
  }
  if (/(^|\/)\.envrc$/.test(lower)) {
    out.add({ rule: 'envrc', severity: 'medium', file, line: 1, snippet: short(text.split('\n')[0] || ''),
      title: 'Has a direnv file that runs when you enter the folder',
      explain: "If you use direnv, this file runs shell code as soon as you cd into the folder (after you allow it). Coding tests don't need one." });
  }
  if (/(^|\/)\.claude\/settings(\.local)?\.json$/.test(lower) && /"hooks"\s*:/.test(text)) {
    out.add({ rule: 'ai-agent-hooks', severity: 'high', file, line: lineOfKey(text, 'hooks'), snippet: short(text.slice(text.indexOf('"hooks"'), text.indexOf('"hooks"') + 160)),
      title: 'Sets up commands for an AI coding assistant to run automatically',
      explain: 'Hooks in this file run shell commands whenever Claude Code does certain things in the folder. If you open the project with an AI assistant, these fire without you typing anything.' });
  }
  if (/(^|\/)\.mcp\.json$/.test(lower) || /(^|\/)\.cursor\/mcp\.json$/.test(lower) || /(^|\/)\.vscode\/mcp\.json$/.test(lower)) {
    out.add({ rule: 'ai-agent-mcp', severity: 'medium', file, line: 1, snippet: short(text, 160),
      title: 'Adds a tool server for AI coding assistants',
      explain: 'AI coding tools may start the programs listed here when you open the project. Check what each one runs.' });
  }
  if (/(^|\/)(\.npmrc|\.yarnrc|\.yarnrc\.yml)$/.test(lower)) {
    const m = text.match(/(?:^|\n)\s*@?[\w-]*:?registry\s*[=:]\s*["']?(\S+?)["']?\s*(?:\n|$)/i) || text.match(/npmRegistryServer\s*:\s*["']?(\S+?)["']?\s*(?:\n|$)/i);
    if (m && !/registry\.(npmjs\.org|yarnpkg\.com|npmmirror\.com)/i.test(m[1])) {
      out.add({ rule: 'custom-registry', severity: 'high', file, line: lineOf(lineIndex(text), text.indexOf(m[0].trim())), snippet: short(m[0]),
        title: 'Installs packages from a private server instead of npm',
        explain: `Every package you install would come from ${short(m[1], 60)}, not the public registry. Whoever runs that server decides what code you get.` });
    }
  }
}

// ---------------------------------------------------------------- python
function scanPython(file, text, out, ctx) {
  const base = file.split('/').pop().toLowerCase();
  if (base === 'setup.py') {
    const re = /\b(os\.system|subprocess\.|urlopen|urllib\.request|requests\.(get|post)|exec\s*\(|eval\s*\(|base64\.b64decode|socket\.socket)/g;
    const starts = lineIndex(text);
    const m = re.exec(text);
    if (m) {
      const s = snippetAt(text, starts, m.index);
      out.add({ rule: 'setup-py-exec', severity: 'high', file, line: s.line, snippet: s.snippet,
        title: 'setup.py runs commands or downloads when you pip install',
        explain: "setup.py runs as a program when you install the project with pip. This one calls the system, the network or exec(), which a normal package setup doesn't need." });
    } else if (/cmdclass\s*=/.test(text)) {
      out.add({ rule: 'setup-py-cmdclass', severity: 'medium', file, line: lineOf(starts, text.indexOf('cmdclass')),
        snippet: short(text.slice(text.indexOf('cmdclass'), text.indexOf('cmdclass') + 120)),
        title: 'setup.py replaces the normal install step with its own code',
        explain: 'The "cmdclass" option swaps in custom code that runs during pip install. Read the class it points to.' });
    }
  }
  if (/^requirements.*\.txt$/.test(base) || base === 'requirements.in') {
    const starts = lineIndex(text);
    text.split('\n').forEach((ln, i) => {
      const t = ln.trim();
      if (!t || t.startsWith('#')) return;
      if (/^(git\+|https?:|--index-url|--extra-index-url|-i\s|-f\s|--find-links)/i.test(t)) {
        out.add({ rule: 'pip-url', severity: /index-url|^-i\s|find-links|^-f\s/.test(t) ? 'high' : 'medium', file, line: i + 1, snippet: short(t),
          title: /index-url|^-i\s|find-links|^-f\s/.test(t) ? 'pip would install packages from a different server' : 'Installs a Python package from a link instead of PyPI',
          explain: 'This package source skips PyPI, so nobody has reviewed it and the owner can swap the code at any time.' });
        return;
      }
      const name = t.split(/[<>=!~;\[\s]/)[0].toLowerCase();
      if (name) {
        ctx.deps.add(name);
        ctx.osv.push({ name, eco: 'PyPI', spec: (t.match(/==\s*([\w.]+)/) || [])[1] || '', file, line: i + 1 });
        const sq = typosquatOf(name, PYPI_LIST, PYPI);
        if (sq) out.add({ rule: 'typosquat', severity: 'medium', file, line: i + 1, snippet: short(t),
          title: `"${name}" is one letter off "${sq}"`,
          explain: `Fake packages often copy a popular name with one letter changed. Check this is really ${sq}.` });
      }
    });
    void starts;
  }
}

// ---------------------------------------------------------------- lockfiles
function scanLockfile(file, text, out, ctx) {
  const base = file.split('/').pop();
  // remember exact installed versions, so the malware check can tell if a hijacked release is pinned
  if (ctx && (base === 'package-lock.json' || base === 'npm-shrinkwrap.json')) {
    try {
      const j = JSON.parse(text);
      for (const [k, v] of Object.entries(j.packages || {})) {
        const name = k.split('node_modules/').pop();
        if (name && v && v.version) (ctx.lockVersions[name] = ctx.lockVersions[name] || new Set()).add(v.version);
      }
      (function walk(deps) { for (const [n, v] of Object.entries(deps || {})) { if (v && v.version) (ctx.lockVersions[n] = ctx.lockVersions[n] || new Set()).add(v.version); walk(v.dependencies); } })(j.dependencies);
    } catch (e) {}
  } else if (ctx && base === 'yarn.lock') {
    const re = /^"?(@?[^@\s"]+)@[^\n]*\n\s+version "?([^"\n]+)"?/gm; let m;
    while ((m = re.exec(text))) (ctx.lockVersions[m[1]] = ctx.lockVersions[m[1]] || new Set()).add(m[2]);
  }
  const hosts = new Map();
  const note = (url, line) => {
    let h; try { h = new URL(url).host; } catch { return; }
    if (/^(registry\.npmjs\.org|registry\.yarnpkg\.com|registry\.npmmirror\.com|codeload\.github\.com)$/.test(h)) return;
    if (!hosts.has(h)) hosts.set(h, { line, url });
  };
  if (base === 'package-lock.json' || base === 'npm-shrinkwrap.json') {
    const re = /"resolved"\s*:\s*"([^"]+)"/g; let m;
    const starts = lineIndex(text);
    while ((m = re.exec(text))) note(m[1], lineOf(starts, m.index));
  } else if (base === 'yarn.lock') {
    const re = /resolved\s+"?([^"\s#]+)/g; let m;
    const starts = lineIndex(text);
    while ((m = re.exec(text))) note(m[1], lineOf(starts, m.index));
  }
  for (const [h, v] of hosts) {
    out.add({ rule: 'lockfile-host', severity: /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(h) ? 'high' : 'medium', file, line: v.line, snippet: short(v.url),
      title: `Lockfile pulls packages from ${h}`,
      explain: "The lockfile decides exactly where npm downloads each package. This entry points somewhere other than the public npm registry, so you'd get whatever that server sends." });
  }
}

// ---------------------------------------------------------------- generic code
const TEST_FILE = /(^|\/)(tests?|__tests__|specs?)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.py$|(^|\/)test_[^/]+\.py$/i;
const ASSERTION = /\bexpect\s*\(|\bassert\w*\s*[.(]|\.toBe\w*\s*\(|\.should\b|\bt\.(is|deepEqual|true|false)\s*\(/;

function scanCode(file, text, out, ctx) {
  const inTest = TEST_FILE.test(file);
  const e = ext(file);
  const isCode = CODE_EXT.has(e) || ctx.forceCode.has(file) || /^#!.*\b(node|python|bash|sh)\b/.test(text.slice(0, 80));
  const builtLike = BUILT_DIR.test(file) || /\.min\.(js|css)$/i.test(file) || /(^|\/)node_modules\//.test(file);
  const starts = lineIndex(text);
  const add = (rule, severity, idx, title, explain, extra) => {
    const s = snippetAt(text, starts, idx);
    // In test files, an address inside an assertion is test data, not a connection.
    if (rule === 'raw-ip' && ASSERTION.test(s.snippet)) severity = 'low';
    // Code-running tricks in test files stay red: fake-recruiter tests tell you to run the tests,
    // so a test file is just as good a hiding place as any other. Only say where it is.
    else if (inTest && severity === 'high' && /^(eval|download-and-run|system-commands|dropper|raw-ip)$/.test(rule)) {
      explain = explain + " This is in a test file, so it runs when you run the tests, which is usually one of the first things you're asked to do.";
    }
    out.add(Object.assign({ rule, severity, file, line: s.line, snippet: s.snippet, title, explain }, extra || {}));
    ctx.fileSev[file] = Math.min(ctx.fileSev[file] ?? 9, SEV_ORDER[severity]);
  };
  let m;

  // hidden far to the right
  const ws = /\S([ \t]{150,})(\S[^\n]{0,200})/g;
  while (isCode && (m = ws.exec(text))) {
    if (!/[;=(){}]|require|import|eval|exec/.test(m[2])) continue;
    add('hidden-offscreen', 'high', m.index + 1 + m[1].length,
    'Code hidden far off to the right of the screen',
    `There are ${m[1].length} spaces in a row before more code on the same line. It's an old trick to push code past the edge of your editor so you don't see it.`);
    break;
  }

  // obfuscator.io style
  const ox = text.match(/\b_0x[0-9a-f]{4,6}\b/g);
  if (ox && ox.length >= 15) add('obfuscated', builtLike ? 'medium' : 'high', text.search(/\b_0x[0-9a-f]{4,6}\b/),
    'Scrambled (obfuscated) code',
    `This file uses ${ox.length} machine-generated names like _0x1a2b, the signature of a code scrambler. A take-home test has no reason to hide what its code does.`);
  const hexRuns = text.match(/(\\x[0-9a-f]{2}){4,}/gi);
  const hexEsc = hexRuns && hexRuns.join('').match(/\\x/g);
  if (hexEsc && hexEsc.length >= 40 && !builtLike) add('hex-escapes', 'medium', text.search(/(\\x[0-9a-f]{2}){4,}/i),
    'Lots of text written as hex codes',
    `${hexEsc.length} characters here are written as \\x codes instead of plain letters, which hides what the text says.`);
  const fcc = /String\.fromCharCode\s*\(\s*(\d+\s*,\s*){19,}/.exec(text);
  if (fcc) add('charcode', 'medium', fcc.index, 'Builds hidden text from character numbers',
    'A long list of numbers is turned into text when the code runs, so the real text never appears in the file.');

  // long base64 / hex blobs
  const b64 = /[A-Za-z0-9+/]{240,}={0,2}/g;
  while ((m = b64.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 60), m.index);
    if (/data:[\w/+.-]+;base64,\s*$|sha(1|256|384|512)-$|integrity|-----BEGIN/i.test(before)) continue;
    if (/^[A-Za-z]+$/.test(m[0]) || /^[0-9]+$/.test(m[0]) || /^[0-9a-fA-F]+$/.test(m[0])) continue;
    if (/0x$/.test(before) || /^0x[0-9a-fA-F]+$/.test(m[0])) continue;
    add('base64-blob', builtLike ? 'low' : 'medium', m.index, 'Long encoded blob',
      `A ${m[0].length}-character block of base64 sits in this file. It's often a hidden script or a packed payload that gets decoded and run later.`);
    break;
  }
  const hex = /\b[0-9a-fA-F]{300,}\b/.exec(text);
  if (hex && !builtLike && !/\.sol$/.test(file)) add('hex-blob', 'medium', hex.index, 'Long hex-encoded blob',
    `A ${hex[0].length}-character hex string, which can hide a script or binary. (Contract bytecode in a web3 test can look like this too.)`);

  if (!isCode && !/\.(json|svg)$/i.test(file)) { scanNetwork(text, add, builtLike, /\.(md|markdown|txt|rst)$/i.test(file)); return; }

  // eval / new Function
  const code = blankStrings(text);
  const evalRe = /\beval\s*\(|\bnew\s+Function\s*\((?!\s*["'`]return this["'`]\s*\))|\bvm\.runIn(This|New)?Context\s*\(|\bexec\s*\(\s*(compile|base64|zlib|marshal|requests|urllib|bytes)/g;
  let evals = 0;
  while ((m = evalRe.exec(code)) && evals < 5) {
    evals++;
    const line = text.slice(Math.max(0, m.index - 120), m.index + 160);
    const decode = /atob|base64|fromCharCode|Buffer\.from|decodeURIComponent|unescape|\.data\b|response|\.text\(\)|marshal|zlib|b64decode|reverse\(\)/i.test(line);
    add('eval', decode ? (builtLike ? 'medium' : 'high') : (builtLike ? 'low' : 'medium'), m.index,
      decode ? 'Decodes hidden text and runs it as code' : 'Runs text as code (eval)',
      decode ? 'This line unpacks encoded or downloaded text and then runs it as a program. That is the core move of almost every malware loader.'
             : "eval and new Function turn plain text into running code. Normal test projects almost never need this, and it's how hidden payloads get started.");
  }

  // download-then-run in the same file
  const net = /\b(fetch\s*\(|axios(\.\w+)?\s*\(|https?\.get\s*\(|https?\.request\s*\(|request\s*\(|got\s*\(|requests\.(get|post)\s*\(|urllib\.request|urlopen\s*\(|XMLHttpRequest|new\s+WebSocket|socket\.io-client|io\s*\(\s*["'`]https?)/;
  const runsCode = /\beval\s*\(|\bnew\s+Function\s*\((?!\s*["'`]return this)|\bvm\.run\w*\s*\(|\bexec\s*\(\s*(compile|base64|zlib|marshal|requests|urllib|bytes|r\.|resp|response|data)/;
  const hasCp = /child_process|\bsubprocess\b|\bos\.system\b/.test(text);
  const runsCmd = /(?<![.\w])(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(|\b(cp|childProcess|child_process|child)\.(exec|spawn|execFile)\w*\s*\(|\bsubprocess\.(run|Popen|call)|\bos\.system\s*\(/;
  if (net.test(text) && !builtLike) {
    if (runsCode.test(code)) add('download-and-run', 'high', code.search(runsCode), 'Downloads something and runs it',
      'This file makes a network request and also turns text into running code. Together, that is how a small loader pulls down the real malware.');
    else if (hasCp && runsCmd.test(text)) add('download-and-run', 'medium', text.search(runsCmd), 'Makes network requests and runs system commands',
      'This file both talks to the internet and launches programs. Build tools sometimes do this; a take-home test usually does not. Check what it downloads and runs.');
  }

  // child_process / os.system
  const cp = /require\(\s*["'`](node:)?child_process["'`]\s*\)|from\s+["'`](node:)?child_process["'`]|import\s*\(\s*["'`](node:)?child_process|\bsubprocess\.(Popen|run|call|check_output)\s*\(|\bos\.(system|popen)\s*\(/g;
  if ((m = cp.exec(text))) {
    const rest = text.slice(m.index, m.index + 4000);
    const risky = /\b(curl|wget|powershell|pwsh|certutil|bitsadmin|mshta|osascript|python3?\s+-c|base64\s+-d|chmod\s+\+x|\/tmp\/|%TEMP%|AppData)/i.test(rest);
    add('system-commands', risky ? 'high' : (builtLike ? 'info' : 'medium'), m.index,
      risky ? 'Runs system commands that download or launch programs' : 'Can run system commands',
      risky ? 'This code runs commands on your computer (like curl, PowerShell or a temp-folder program). Coding tests should never need that.'
            : 'This code can run commands on your computer. Some build scripts do this legitimately, so check what it actually runs.');
  }

  // dynamic require of a hidden path / writing then running files
  // A dropper writes a file and then runs THAT file: the path written has to show up in the run call
  // (or be made executable in between). Writing a marker file and separately starting a process isn't one.
  const dropper = /writeFileSync?\s*\(\s*([^,)]{1,120})[^)]{0,200}\)\s*;?([\s\S]{0,400}?)\b(exec|spawn|execFile|fork)(Sync)?\s*\(([^;]{0,200})/g;
  let dm, hit = null;
  while ((dm = dropper.exec(text))) {
    const target = dm[1].trim().replace(/^['"`]|['"`]$/g, '').replace(/\$\{[^}]*\}/g, '').trim();
    const ran = dm[5] || '';
    if (/chmod/.test(dm[2]) || (target.length >= 2 && ran.includes(target))) { hit = dm; break; }
  }
  if ((m = hit) && !builtLike) add('dropper', 'high', m.index, 'Writes a file and then runs it',
    'This code saves something to disk and launches it straight after, the classic "dropper" pattern.');

  // home-directory poking
  const home = /\b(os\.homedir\s*\(\)|process\.env\.(HOME|USERPROFILE|APPDATA|LOCALAPPDATA)|os\.path\.expanduser\s*\(|Path\.home\s*\(\)|%APPDATA%|%LOCALAPPDATA%|~\/Library\/(Application Support|Keychains))/g;
  if ((m = home.exec(text)) && !builtLike) {
    const nearby = text.slice(Math.max(0, m.index - 400), m.index + 1500);
    if (/readdir|readFile|existsSync|listdir|glob|walk|copyFile|createReadStream|open\s*\(/.test(nearby)) {
      add('home-dir', 'medium', m.index, 'Reads files from your home folder',
        "This code looks around your personal folders. Test projects work inside their own folder; there's no reason to read yours.");
    }
  }

  // wallets, passwords, keys
  for (const [re, what, need] of SECRET_PATHS) {
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    if (!(m = r.exec(text))) continue;
    // A project's own .npmrc (a test fixture, a setup script writing registry config) is normal.
    // It only counts when the code reaches for YOUR copy in the home folder, or for the token inside it.
    if (need === 'home' && !/\.git-credentials/.test(m[0])) {
      const near = text.slice(Math.max(0, m.index - 300), m.index + 300);
      if (!/homedir\s*\(|process\.env\.(HOME|USERPROFILE)|\$HOME|['"`]~[\/\\]|expanduser|_authToken/.test(near)) continue;
    }
    add('secret-paths', 'high', m.index, `Looks for ${what}`,
      `The code mentions ${what}. Stealing these is the main goal of this kind of malware, and an ordinary project has no reason to touch them.`, { target: what });
  }

  // platform fingerprinting + temp-folder dropping
  if (/process\.platform|platform\.system\(\)|os\.platform\(\)/.test(text) && /\b(tmpdir|\/tmp\/|TEMP|AppData)\b/.test(text) && /\b(exec|spawn|writeFile|chmod)/.test(text) && !builtLike) {
    add('platform-drop', 'medium', text.search(/process\.platform|platform\.system\(\)|os\.platform\(\)/),
      'Checks your operating system, then writes or runs files in a temp folder',
      'Malware often picks a different payload for Windows, Mac and Linux, drops it in a temp folder and runs it. This file does those steps.');
  }

  // very long single lines in source that should be readable
  if (!builtLike && isCode && !/\.d\.[cm]?ts$/.test(file)) {
    let longest = 0, at = 0;
    for (let i = 0; i < starts.length; i++) {
      const len = (i + 1 < starts.length ? starts[i + 1] - 1 : text.length) - starts[i];
      if (len > longest) { longest = len; at = starts[i]; }
    }
    const lineText = text.slice(at, at + longest);
    const codeOnly = lineText.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
    if (longest > 3000 && codeOnly.length > 1500) add('packed-line', 'medium', at, 'Packed code in a file that should be readable',
      `One line in this file is ${longest.toLocaleString('en-GB')} characters long. Hand-written test code doesn't look like that; packed or minified code hides what it does.`);
  }

  scanNetwork(text, add, builtLike, false);
}

function scanNetwork(text, add, builtLike, docLike) {
  let m;
  const ipUrl = /\b(?:https?|wss?|ftp|tcp):\/\/((?:\d{1,3}\.){3}\d{1,3})(?::\d{2,5})?/g;
  let n = 0;
  while ((m = ipUrl.exec(text)) && n < 3) {
    if (PRIVATE_IP.test(m[1]) || m[1] === '0.0.0.0' || BENIGN_IP.has(m[1])) continue;
    n++;
    add('raw-ip', 'high', m.index, `Connects to a bare IP address (${m[1]})`,
      "Real services use domain names. Talking straight to an IP address is how many malware loaders reach the attacker's server.", { ip: m[1] });
  }
  if (!n) {
    const ipStr = /["'`]((?:\d{1,3}\.){3}\d{1,3})["'`]\s*[,)]?\s*(?:[,:]\s*\d{2,5}|\+?\s*["'`]?:\d{2,5})?/g;
    while ((m = ipStr.exec(text)) && n < 2) {
      if (PRIVATE_IP.test(m[1]) || BENIGN_IP.has(m[1]) || /^(\d+)\.\1\.\1\.\1$/.test(m[1]) || m[1].split('.').some(x => +x > 255)) continue;
      if (/version|ver\b|semver/i.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
      n++;
      add('raw-ip', (builtLike || docLike) ? 'low' : 'medium', m.index, `Hardcoded IP address (${m[1]})`,
        'An internet address is written straight into the code. Check what connects to it.', { ip: m[1] });
    }
  }
  if ((m = PASTE_HOSTS.exec(text))) add('paste-site', 'high', m.index, `Pulls content from ${m[0]}`,
    'Paste and file-drop sites are a favourite place to host the second stage of malware, because the content can be changed after you get the test.');
  else if ((m = SOFT_HOSTS.exec(text)) && !builtLike) add('paste-site', 'low', m.index, `Loads a file from ${m[0]}`,
    "Files loaded from here can be changed later by whoever controls them. Usually harmless (badges, configs, NFT images), but check it isn't fetching code to run.");
  if ((m = TUNNEL_HOSTS.exec(text))) add('tunnel', 'medium', m.index, `Uses a tunnel or request-catcher service (${m[0]})`,
    'These services give anyone a temporary public address. Attackers use them to receive stolen data or serve payloads.');
  if ((m = WEBHOOK.exec(text))) add('webhook-exfil', 'high', m.index, 'Sends data to a Discord, Telegram or Slack bot',
    'A webhook or bot address is built into the code. Stolen passwords and wallet files are often posted straight to a chat like this.');
  if ((m = GEO_LOOKUP.exec(text)) && !builtLike) add('ip-lookup', 'low', m.index, 'Looks up your public IP address',
    'Malware often checks where you are before deciding what to do. On its own this is common and usually harmless.');
}

// ---------------------------------------------------------------- AI-agent instructions
function scanAgentInstructions(file, text, out) {
  const base = file.split('/').pop().toLowerCase();
  if (!/^(claude\.md|agents\.md|\.cursorrules|\.windsurfrules|copilot-instructions\.md|gemini\.md)$/.test(base) && !/\.cursor\/rules\//.test(file)) return;
  const starts = lineIndex(text);
  const inj = /(ignore (all )?(previous|prior|above) instructions|do not (tell|inform|mention)( this)? (to )?the user|without (asking|telling) the user|run (this|the following) (command|script) (first|immediately|before)|curl\s+\S+\s*\|\s*(ba)?sh|npm install -g|silently)/i;
  const m = inj.exec(text);
  if (m) {
    const s = snippetAt(text, starts, m.index);
    out.add({ rule: 'agent-injection', severity: 'high', file, line: s.line, snippet: s.snippet,
      title: 'Gives hidden orders to AI coding assistants',
      explain: 'This file is read automatically by AI coding tools. It contains instructions to run commands or keep things from you. The Binance attackers also abused an AI tool once inside.' });
  } else {
    out.add({ rule: 'agent-file', severity: 'info', file, line: 1, snippet: short(text, 120),
      title: 'Contains instructions for AI coding assistants',
      explain: "AI tools read this file automatically. Nothing suspicious was found in it, but skim it if you'll use an AI assistant on this project." });
  }
}

// ---------------------------------------------------------------- per-file type checks
function scanFileType(f, out, ctx) {
  const e = ext(f.path);
  const base = f.path.split('/').pop();
  if (f.traversal) out.add({ rule: 'path-traversal', severity: 'high', file: f.path, line: 0, snippet: short(f.rawPath),
    title: 'Archive tries to write outside its own folder',
    explain: 'One file in this archive is named so it would unpack into another place on your computer (using ../ or an absolute path). Honest archives never do this.' });
  if (f.kind === 'symlink') {
    const t = String(f.linkTarget || '');
    const escapes = t.startsWith('/') || t.startsWith('~') || /^[a-zA-Z]:/.test(t) || t.split('/').filter(x => x === '..').length >= 2;
    out.add({ rule: 'symlink', severity: escapes ? 'high' : 'low', file: f.path, line: 0, snippet: short(`→ ${t}`),
      title: escapes ? 'Shortcut that points outside the project' : 'Contains a shortcut (symlink)',
      explain: escapes ? 'This link points to a place outside the project folder, possibly your own files. Tools that follow it could read or overwrite them.'
                       : 'A symbolic link to another file in the project. Usually harmless.' });
    return;
  }
  if (f.kind === 'encrypted') { out.add({ rule: 'encrypted', severity: 'medium', file: f.path, line: 0, snippet: '',
    title: "Password-protected file we can't look inside",
    explain: "Attackers lock files so scanners can't read them. If the test came with a password, be extra careful with this file." }); return; }
  if (f.bomb) out.add({ rule: 'zip-bomb', severity: 'medium', file: f.path, line: 0, snippet: '',
    title: 'Compressed far beyond normal',
    explain: 'This file unpacks to a huge size from a tiny one. It could be a "zip bomb" meant to crash tools.' });
  if (f.kind !== 'file') return;

  if (BIN_HIGH.has(e)) out.add({ rule: 'binary', severity: 'high', file: f.path, line: 0, snippet: `${(f.size / 1024).toFixed(0)} KB`,
    title: `Contains a ready-to-run program (.${e})`,
    explain: e === 'node' ? 'A compiled .node add-on runs native code the moment any JavaScript requires it. Nothing in a take-home test should ship one.'
                          : 'A compiled program is inside the project. A coding test is source code for you to read; there\'s no reason to include something that runs on its own.' });
  else if (BIN_MED.has(e)) out.add({ rule: 'binary', severity: 'medium', file: f.path, line: 0, snippet: `${(f.size / 1024).toFixed(0)} KB`,
    title: `Contains compiled code (.${e})`, explain: "This file is compiled, so it can't be read like normal source code. Ask why it's needed." });
  else if (ARCHIVE_EXT.has(e)) out.add({ rule: 'nested-archive', severity: 'medium', file: f.path, line: 0, snippet: `${(f.size / 1024).toFixed(0)} KB`,
    title: 'Contains another archive inside', explain: "We can't see inside archives within archives. Hiding a payload a layer deeper is a common way to dodge scanners." });

  if (e in DISGUISE_EXT && f.data.length > 32) {
    const magics = DISGUISE_EXT[e];
    const hasMagic = magics.length === 0 || magics.some(mg => mg.every((b, i) => f.data[i] === b));
    const txt = f.data.subarray(0, 8192).toString('latin1');
    const codey = /require\s*\(|eval\s*\(|function\s*\(|=>|import\s+\w|module\.exports|child_process|exec\s*\(|import\s+os|def\s+\w+\(/.test(txt);
    if ((!hasMagic && printableRatio(f.data) > 0.9 && codey) || (codey && /eval\s*\(|child_process|module\.exports/.test(txt) && printableRatio(f.data) > 0.85)) {
      out.add({ rule: 'disguised-file', severity: 'high', file: f.path, line: 0, snippet: short(txt.replace(/[^\x20-\x7e]/g, ' '), 140),
        title: `Code disguised as a .${e} file`,
        explain: `This file claims to be a ${e.toUpperCase()} but it's actually code. Hiding the payload inside a fake font or image is a known trick in these attacks.` });
      ctx.textFiles.push(f);
      ctx.forceCode.add(f.path);
    }
  }

  if (/(^|\/)node_modules\//.test(f.path) && !ctx.flaggedNodeModules) {
    ctx.flaggedNodeModules = true;
    out.add({ rule: 'committed-node-modules', severity: 'medium', file: f.path.slice(0, f.path.indexOf('node_modules/') + 12), line: 0, snippet: '',
      title: 'Ships its own node_modules folder',
      explain: 'Projects normally download packages fresh. A bundled node_modules folder can hold edited copies of trusted packages with malware added, and npm will use them as they are. We scanned the code inside too.' });
  }
  if (f.truncated) ctx.truncated.push(f.path);
}

// ---------------------------------------------------------------- npm registry (optional, async)
// Known malicious packages, from OSV's database (it carries the OpenSSF malicious-packages list, ids starting MAL-).
// A package that is malicious in every version is a red flag outright. One where only certain releases were
// hijacked is flagged as worth checking, unless the project pins exactly one of the bad versions.
async function knownMalware(ctx, out, opts) {
  if (!opts.network || !ctx.osv.length) return;
  const seen = new Set();
  const list = ctx.osv.filter(d => { const k = d.eco + ':' + d.name; return !seen.has(k) && seen.add(k); }).slice(0, 300);
  const post = async (url, body) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    try { const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.ok ? r.json() : null; }
    catch (e) { return null; } finally { clearTimeout(t); }
  };
  const get = async (url) => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    try { const r = await fetch(url, { signal: ctrl.signal }); return r.ok ? r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); }
  };
  const res = await post('https://api.osv.dev/v1/querybatch', { queries: list.map(d => ({ package: { name: d.name, ecosystem: d.eco } })) });
  if (!res || !Array.isArray(res.results)) return;
  ctx.osvChecked = list.length;
  await Promise.all(res.results.map(async (r, i) => {
    const mal = (r && r.vulns || []).filter(v => /^MAL-/.test(v.id)).slice(0, 3);
    if (!mal.length) return;
    const d = list[i];
    let whole = false; const bad = new Set();
    for (const v of mal) {
      const full = await get('https://api.osv.dev/v1/vulns/' + encodeURIComponent(v.id));
      for (const a of (full && full.affected) || []) {
        if (!a.package || a.package.name.toLowerCase() !== d.name.toLowerCase()) continue;
        (a.versions || []).forEach(x => bad.add(x));
        for (const rg of a.ranges || []) {
          const ev = rg.events || [];
          if (ev.some(e => e.introduced === '0') && !ev.some(e => e.fixed || e.last_affected)) whole = true;
        }
        if (!(a.versions || []).length && !(a.ranges || []).length) whole = true;
      }
    }
    const pinned = String(d.spec || '').replace(/^[=v\s]+/, '');
    const locked = [...(ctx.lockVersions[d.name] || [])].filter(v => bad.has(v));
    // npm pulls hijacked releases once they're caught, so a loose range ("^4.3.0") can't install them any more.
    // Only a lockfile or an exact pin can still bring one in.
    if (!whole && !bad.has(pinned) && !locked.length) return;
    if (locked.length) d.spec = locked[0];
    if (whole || bad.has(pinned) || locked.length) {
      out.add({ rule: 'known-malware', severity: 'high', file: d.file, line: d.line, snippet: `${d.name}${d.spec ? '@' + d.spec : ''}`,
        title: whole ? `"${d.name}" is a known malicious package` : `Installs a hijacked release of "${d.name}"`,
        explain: whole ? `"${d.name}" is listed in the public malicious-packages database (${mal[0].id}). Every version is malware.`
                       : `This project pins ${d.name}@${locked[0] || pinned}, a release listed in the public malicious-packages database (${mal[0].id}).` });
    } else {
      const few = [...bad].slice(0, 6).join(', ');
      out.add({ rule: 'known-malware-versions', severity: 'medium', file: d.file, line: d.line, snippet: `${d.name}${d.spec ? '@' + d.spec : ''}`,
        title: `Some releases of "${d.name}" were hijacked with malware`,
        explain: `The public malicious-packages database (${mal[0].id}) lists bad releases of this package${few ? ': ' + few : ''}. Check the lockfile and make sure you don't install one of them.` });
    }
  }));
}

async function registryChecks(ctx, out, opts) {
  if (!opts.network || !ctx.unknownDeps.length) return;
  const seen = new Set();
  const list = ctx.unknownDeps.filter(d => !seen.has(d.name) && seen.add(d.name) && !d.name.startsWith('@types/')).slice(0, 30);
  const now = Date.now();
  await Promise.all(list.map(async d => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch('https://registry.npmjs.org/' + d.name.replace('/', '%2f'), { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (res.status === 404) {
        out.add({ rule: 'npm-missing', severity: 'high', file: d.file, line: d.line, snippet: d.name,
          title: `"${d.name}" doesn't exist on npm`,
          explain: "npm has no package by this name. It may have been taken down after being caught as malware, or it's a private name that anyone could register and fill with malware." });
        return;
      }
      if (!res.ok) return;
      const len = +res.headers.get('content-length') || 0;
      if (len > 6 * 1024 * 1024) return;
      const j = await res.json();
      const latest = j['dist-tags'] && j['dist-tags'].latest;
      // Only when npm has actually replaced the package: the current version IS the security placeholder.
      // (Some big packages carry an old 2016-era placeholder from a name dispute; that doesn't count.)
      if (latest && /-security$/.test(latest)) {
        out.add({ rule: 'npm-removed-malware', severity: 'high', file: d.file, line: d.line, snippet: `${d.name}@${latest}`,
          title: `npm took "${d.name}" down as malicious`,
          explain: 'npm replaced this package with an empty security placeholder, which is what it does after finding malware in it.' });
        return;
      }
      const created = j.time && Date.parse(j.time.created);
      if (created) {
        const days = Math.floor((now - created) / 86400000);
        if (days <= 30) out.add({ rule: 'npm-new', severity: days <= 7 ? 'high' : 'medium', file: d.file, line: d.line, snippet: d.name,
          title: `"${d.name}" was published ${days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago'}`,
          explain: "Brand-new packages haven't been looked at by anyone yet. Malicious repos often depend on a package the attackers published days before." });
        const versions = j.versions ? Object.keys(j.versions).length : 0;
        const dl = j.time && j.time.modified;
        void dl;
        if (versions === 1 && days <= 90 && days > 30) out.add({ rule: 'npm-thin', severity: 'low', file: d.file, line: d.line, snippet: d.name,
          title: `"${d.name}" is a young package with a single version`,
          explain: "Not suspicious on its own, but it has little history. Check it's what the project actually needs." });
      }
    } catch { /* network trouble: skip quietly */ } finally { clearTimeout(t); }
  }));
}

// ---------------------------------------------------------------- main entry
async function scanFiles(files, opts = {}) {
  const out = new Collector();
  const ctx = { installRun: new Set(), startRun: new Set(), deps: new Set(), unknownDeps: [], osv: [], lockVersions: {}, fileSev: {}, textFiles: [], truncated: [], flaggedNodeModules: false, forceCode: new Set(), openRun: new Set(), asDependency: !!opts.asDependency };
  let scanned = 0, bytes = 0;

  for (const f of files) {
    scanFileType(f, out, ctx);
    if (f.kind !== 'file' || !f.data.length) continue;
    bytes += f.data.length;
    const e = ext(f.path);
    const textish = TEXT_EXT.has(e) || (!(e in DISGUISE_EXT) && !BIN_HIGH.has(e) && !BIN_MED.has(e) && looksText(f.data));
    if (!textish) continue;
    if (!looksText(f.data)) {
      if (CODE_EXT.has(e)) out.add({ rule: 'binary-in-source', severity: 'medium', file: f.path, line: 0, snippet: '',
        title: `A .${e} file that isn't really text`, explain: 'This file is named like source code but contains binary data.' });
      continue;
    }
    ctx.textFiles.push(f);
  }

  for (const f of ctx.textFiles) {
    const text = f.data.toString('utf8');
    scanned++;
    const base = f.path.split('/').pop();
    if (base === 'package.json') scanPackageJson(f.path, text, out, ctx);
    scanAutoRun(f.path, text, out, ctx);
    scanPython(f.path, text, out, ctx);
    scanAgentInstructions(f.path, text, out);
    if (SKIP_GENERIC.test(f.path)) { scanLockfile(f.path, text, out, ctx); continue; }
    scanCode(f.path, text, out, ctx);
  }

  await registryChecks(ctx, out, opts);
  await knownMalware(ctx, out, opts);

  // Link install-time scripts to what's inside them.
  for (const file of new Set([...ctx.openRun, ...ctx.installRun, ...ctx.startRun])) {
    const bad = out.list.filter(x => x.file === file && (x.severity === 'high' || x.severity === 'medium') && x.rule !== 'install-hook' && x.rule !== 'chain');
    if (!bad.length) continue;
    const when = ctx.openRun.has(file) ? 'as soon as you open the folder in VS Code'
      : ctx.installRun.has(file) ? 'the moment you run npm install' : 'when you start or test the project';
    out.list.push({ rule: 'chain', severity: 'high', file, line: bad[0].line, snippet: bad[0].snippet,
      title: `Suspicious code runs ${when}`,
      explain: `${file} starts by itself ${when}. Inside it we found: ${bad.slice(0, 3).map(b => b.title.charAt(0).toLowerCase() + b.title.slice(1)).join('; ')}${bad.length > 3 ? `, plus ${bad.length - 3} more` : ''}.`,
      redCount: bad.length,
      when: ctx.openRun.has(file) ? 'open' : ctx.installRun.has(file) ? 'install' : 'start' });
  }

  const findings = out.list.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.rule === 'chain' ? -1 : b.rule === 'chain' ? 1 : 0));
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  findings.forEach(f => counts[f.severity]++);
  return {
    findings, counts,
    coverage: { files: files.length, scanned, bytes, deps: ctx.deps.size, truncated: ctx.truncated.length,
      registryChecked: opts.network ? Math.min(30, new Set(ctx.unknownDeps.map(d => d.name)).size) : 0, malwareChecked: ctx.osvChecked || 0 },
    installRun: [...ctx.installRun],
  };
}

module.exports = { scanFiles, _internals: { typosquatOf, parseJsonc, looksText } };
