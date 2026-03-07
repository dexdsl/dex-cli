#!/usr/bin/env node
import { auditEntryRuntime } from './lib/entry-runtime-audit.mjs';

async function main() {
  const result = await auditEntryRuntime({
    entriesDir: './entries',
    all: true,
    includeLegacy: false,
  });

  for (const report of result.reports) {
    if (report.skippedLegacy) {
      console.log(`SKIP ${report.slug} (legacy exemption)`);
      continue;
    }
    const status = report.ok ? 'PASS' : 'FAIL';
    console.log(`${status} ${report.slug}`);
    if (!report.ok) {
      for (const issue of report.issues) {
        console.log(`  - ${issue}`);
      }
    }
  }

  const nonSkippedReports = result.reports.filter((report) => !report.skippedLegacy);
  if (!result.reports.length) {
    console.error('verify:entry-runtime-readiness failed: no entry pages were audited.');
    process.exit(1);
  }
  if (!nonSkippedReports.length) {
    console.error('verify:entry-runtime-readiness failed: no non-exempt entry pages were audited.');
    process.exit(1);
  }

  if (result.failures > 0) {
    console.error(`verify:entry-runtime-readiness failed (${result.failures}/${result.reports.length}).`);
    process.exit(1);
  }
  console.log(`verify:entry-runtime-readiness passed (${result.reports.length} entries, skipped=${result.skipped}).`);
}

main().catch((error) => {
  console.error(`verify:entry-runtime-readiness failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
