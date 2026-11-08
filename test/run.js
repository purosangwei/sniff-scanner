const fs = require('fs'); const path = require('path');
const { scanArchive } = require('../lib/report');
(async () => {
  for (const n of process.argv.slice(2)) {
    const t = Date.now();
    try {
      const r = await scanArchive(fs.readFileSync(path.join(__dirname, 'fixtures', n)), n, { network: process.env.NET === '1' });
      console.log(`\n=== ${n}  ${r.verdict.toUpperCase()}  ${JSON.stringify(r.counts)}  ${Date.now()-t}ms  files=${r.coverage.files}`);
      console.log('  summary:', r.summary.join(' | '));
      for (const f of r.findings) console.log(`  [${f.severity}] ${f.title}  — ${f.file}:${f.line}${f.more?` (+${f.more})`:''}`);
    } catch (e) { console.log(`\n=== ${n} ERROR: ${e.message}`); }
  }
})();
