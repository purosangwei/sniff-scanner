# $SNIFF Repo Scanner

Live at **[sniffrepo.com](https://sniffrepo.com)**.

Scans a repo before you run it (a recruiter's take-home coding test, a starter kit, a tool from a stranger) for the tricks used in fake-recruiter malware attacks. Paste a GitHub link or drop a zip and get a red / amber / grey report in plain English.

**It never runs the code.** GitHub repos are downloaded as a tarball into memory (no `git clone`, so no hooks, submodules or LFS filters), archives are unpacked in memory (nothing written to disk), and every check is a text rule. No dependencies at all.

## Run it

```
node server.js            # http://localhost:3000
npm test                  # runs the scanner over the test projects in test/fixtures
```

Node 20+. Environment variables, all optional:

| Variable | What it does |
| --- | --- |
| `PORT` | Port to listen on (default 3000) |
| `GITHUB_TOKEN` | Any GitHub token with no scopes. Raises GitHub's limit from 60 to 5,000 lookups an hour. **Set this in production.** |
| `TELEGRAM_BOT_TOKEN` | Starts the Telegram bot in the same process (`/scan <link>` or send a zip) |
| `PUBLIC_URL` | Your site's address, used in the bot's "full report" links |
| `DATA_DIR` | Where shareable results are saved (default `./data`) |
| `RATE_MAX` | Scans per IP per 10 minutes (default 15) |
| `MAX_CONCURRENT` | Scans running at once (default 3) |

`render.yaml` deploys it to Render with a 1 GB disk so result links survive restarts. On a plan without a disk it still works, but shared links reset on each deploy.

## Command line

Scan before you install or run anything:

```
node cli.js ./some-folder
node cli.js test.zip
node cli.js github.com/owner/repo      # falls back to the live site if GitHub is blocked
node cli.js npm:package@1.2.3          # downloads the package tarball into memory, never installs it
```

Add `--json` for machine-readable output and `--offline` to skip npm lookups. Exit codes: 0 no known red flags, 1 worth checking, 2 red flags, 3 could not scan.

## What it checks

- npm install hooks (`preinstall`, `install`, `postinstall`, `prepare`), following `npm run x` chains, and linking each hook to the file it runs
- VS Code tasks with `"runOn": "folderOpen"`, `task.allowAutomaticTasks`, dev container `initializeCommand`, `.envrc`
- AI assistant traps: `.claude/settings.json` hooks, `.mcp.json`, prompt injection in `CLAUDE.md` / `AGENTS.md` / `.cursorrules`
- eval / `new Function` (higher when it decodes text first), download-then-run, `child_process` with curl / PowerShell / temp folders, write-then-run droppers
- Obfuscation: obfuscator.io names, hex-escaped strings, `fromCharCode` lists, long base64 and hex blobs, packed lines, code hidden off-screen behind long runs of spaces
- Network: bare IP addresses, paste and file-drop sites, tunnels and request catchers, Discord / Telegram / Slack webhooks, IP geolocation lookups
- Wallet and credential theft: MetaMask, Phantom, Coinbase, Trust, TronLink extension IDs, browser password / cookie / key files, SSH keys, Solana CLI, Exodus, Electrum, AWS, Telegram Desktop
- Packages: lookalike names, installs from Git / URL / file, private registries in `.npmrc` / `.yarnrc`, lockfile hosts, and live npm lookups (missing packages, packages npm removed as malware, packages under 30 days old)
- Python: `setup.py` that runs commands or downloads, custom `cmdclass`, `requirements.txt` from URLs or other indexes, lookalike names
- Files: executables, native `.node` add-ons, compiled code, nested archives, code disguised as fonts or images, committed `node_modules`, encrypted entries, path traversal, symlinks pointing outside, zip bombs
- Repo: brand-new repo or owner account, single-commit history, near-empty personal accounts

## Honest limits

It catches known tricks. A brand-new technique, or a payload fetched at runtime from a server that looked harmless when we scanned, can get past it. That's why the clear result says "No known red flags", never "safe". If you don't know the company, open the test in a VM.

## Layout

```
server.js        web server and API (POST /api/scan, POST /api/upload, GET /api/r/:id)
bot.js           Telegram bot
lib/archive.js   in-memory tar.gz and zip reader with size, count and bomb limits
lib/github.js    GitHub link parsing, tarball download, repo-age signals
lib/scanner.js   the rule set
lib/report.js    verdict, plain-English summary, report shape
public/          the page (glow-field inputs, live link check, shareable results)
test/            inert fake-attack fixtures and a clean project
```
