import { readFile } from 'node:fs/promises';
import { reconcileSealedExport } from './reconcile-sealed-export.mjs';
const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run reconcile -- /absolute/path/to/event-export.json');
  process.exit(1);
}
let data;
try {
  data = JSON.parse(await readFile(path, 'utf8'));
} catch {
  // Native JSON parse errors can include the source, which may contain private event data.
  console.error('FAIL: Unable to read a valid JSON export. Check the file and try again.');
  process.exit(1);
}
if (data.schemaVersion === 2) {
  const report = reconcileSealedExport(data);
  console.log(`${report.valid ? 'PASS' : 'FAIL'} sealed funding reconciliation`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.valid ? 0 : 1);
}
console.error('FAIL: This tool requires a current sealed-funding event export (schemaVersion 2).');
process.exitCode = 1;
