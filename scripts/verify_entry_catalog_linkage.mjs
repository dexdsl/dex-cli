#!/usr/bin/env node
import path from 'node:path';
import { verifyCatalogEntryLinkage } from './lib/entry-runtime-audit.mjs';

async function main() {
  const catalogFile = path.resolve('data', 'catalog.editorial.json');
  const result = await verifyCatalogEntryLinkage({ catalogFile });
  if (result.failures.length > 0) {
    console.error(`verify:entry-catalog-linkage failed (${result.failures.length}/${result.count} active rows).`);
    for (const failure of result.failures) {
      const token = failure.checked.entryId || failure.checked.entryHref || '(unknown)';
      console.error(`- ${token}: ${failure.checked.issues.join('; ')}`);
      if (Array.isArray(failure.checked.candidatePaths) && failure.checked.candidatePaths.length) {
        console.error(`  candidates: ${failure.checked.candidatePaths.join(', ')}`);
      }
    }
    process.exit(1);
  }
  console.log(`verify:entry-catalog-linkage passed (${result.count} active rows).`);
}

main().catch((error) => {
  console.error(`verify:entry-catalog-linkage failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

