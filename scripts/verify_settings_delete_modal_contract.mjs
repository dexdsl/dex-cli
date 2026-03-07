#!/usr/bin/env node
import { readFileSync } from "node:fs";

const settingsPath = "/Users/seb/dexdsl.github.io/docs/entry/settings/index.html";
const html = readFileSync(settingsPath, "utf8");

const requiredMarkers = [
  'id="accountDeleteModal"',
  'data-dx-delete-step="gate-subscription"',
  'data-dx-delete-panel="blocked-subscription"',
  'data-dx-delete-panel="confirm-phrase"',
  'id="dxDeleteExpectedPhrase"',
  'I want to delete my dex account, member.',
  "BILLING_ENDPOINTS.accountDelete",
  "/me/account/delete",
  "openPortalSession('subscription_cancel')",
  "dx-btn-danger-solid",
];

const missing = requiredMarkers.filter((marker) => !html.includes(marker));
if (missing.length) {
  console.error("verify:settings-delete failed");
  missing.forEach((marker) => console.error(`- Missing marker: ${marker}`));
  process.exit(1);
}

console.log("verify:settings-delete passed.");
