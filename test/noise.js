const fs = require('fs'); const path = require('path');
const { scanArchive } = require('../lib/report');
(async () => {
  const dir = process.argv[2];
  for (const n of fs.readdirSync(dir).filter(x => x.endsWith('.tgz'))) {
    const t = Date.now();
    try {
      const r = await scanArchive(fs.readFileSync(path.join(dir, n)), n, { network: false });
      console.log(`\n=== ${n} ${r.verdict.toUpperCase()} ${JSON.stringify(r.counts)} ${Date.now()-t}ms files=${r.coverage.files}`);
      for (const f of r.findings.filter(f => f.severity==='high'||f.severity==='medium').slice(0,12)) console.log(`  [${f.severity}] ${f.rule}: ${f.title} — ${f.file}:${f.line} :: ${String(f.snippet).slice(0,110)}`);
    } catch (e) { console.log(`\n=== ${n} ERROR ${e.message}`); }
  }
})();
