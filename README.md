# Dex Operations Manual

Canonical staff operations guide for the Dex TUI/CLI stack in this repo.

This manual is the source of truth for:
1. Workspace bootstrap.
2. TUI command centers and keybindings.
3. CLI command flags and capabilities.
4. Production-safe entry/content/infra workflows.

## Workspace Bootstrap (site + api repos)

### First run
1. Install dependencies in this repo:
```bash
npm i
```
2. Run Dex:
```bash
node scripts/dex.mjs
```
or:
```bash
npm run dex
```
3. If workspace roots are not configured, run:
```bash
dex setup
```

### Workspace setup commands
```bash
dex setup
dex setup --reset
dex setup --repo site
dex setup --repo api
```

### Workspace config file and overrides
1. Default config path:
```text
~/.config/dexdsl/workspaces.json
```
2. Optional overrides:
- `DEX_WORKSPACE_FILE` (explicit config file path)
- `DEX_CONFIG_DIR` (alternate config home)

### Operational behavior
1. Dex auto-resolves and `chdir`s to configured repo root before command execution.
2. Default active repo is `site` unless `--repo api` is passed.
3. If no valid workspace config exists in non-interactive mode, Dex falls back to current working directory and prints guidance.

## Command Taxonomy

Dex dashboard groups commands into:

1. Entry Commands
- `init`
- `update`
- `doctor`
- `entry audit`

2. Content Commands
- `catalog`
- `home`
- `notes`
- `polls`
- `newsletter`

3. Infrastructure Commands
- `assets`
- `status`
- `deploy`
- `view`
- `release`
- `setup`

## CLI Command Reference

Use either:
```bash
node scripts/dex.mjs <command> ...
```
or:
```bash
npm run dex -- <command> ...
```
or (if linked):
```bash
dex <command> ...
```

### Global routing
```bash
dex --repo site <command> ...
dex --repo api <command> ...
```

### `dex init`
Purpose: create a new entry via wizard (TTY) or seeded non-interactive flow (`--from`).

Supported flags:
- `--quick`
- `--dry-run`
- `--flat`
- `--open`
- `--template <path>`
- `--out <dir>`
- `--from <json>`
- `--catalog-link <create-linked|attach-existing|off>`
- `--catalog-file <path>`
- `--catalog-status <draft|active|archived>`
- `--catalog-entry-id <id>`
- `--catalog-entry-href <href>`
- `--catalog-lookup <lookup>`
- `--catalog-season <season>`
- `--catalog-performer <name>`
- `--catalog-instrument <instrument>`

Examples:
```bash
dex init
dex init tim-feeney --template ./entry-template/index.html --out ./entries
dex init --from ./tmp/seed.json --catalog-link create-linked --catalog-status draft
```

### `dex update`
Purpose: rehydrate and edit an existing entry in TUI mode.

Notes:
1. Requires a TTY.
2. Supports recording index import from the update flow.
3. Saves and regenerates `entries/<slug>/index.html`.

### `dex doctor`
Purpose: scan generated entries for drift/health.

Modes:
1. TTY: interactive doctor screen with optional repair.
2. Non-TTY: prints per-entry report and exits nonzero on errors.

### `dex entry`
Usage:
```bash
dex entry audit [--slug <slug>] [--all] [--inventory-only]
dex entry link --entry <slug> [--catalog <id|href|slug>] [--status draft|active|archived] [--dry-run]
```

`entry audit` key flags:
- `--slug <slug>`
- `--all`
- `--inventory-only`
- `--entries-dir <path>`
- `--include-legacy`
- `--catalog-entries-file <path>`
- `--catalog-file <path>`
- `--assets-file <path>`

`entry link` optional metadata flags:
- `--lookup`
- `--season`
- `--performer`
- `--instrument`
- `--title`
- `--catalog-file <path>`
- `--catalog-entries-file <path>`

### `dex catalog`
Usage:
```bash
dex catalog <manifest|stage|spotlight|validate|diff|publish|pull|seasons> [args]
```

Manifest:
```bash
dex catalog manifest list [--all]
dex catalog manifest add --entry <slug|href|id> --lookup <lookup> --season <S#> --instrument <...> --performer <...>
dex catalog manifest edit --entry <slug|href|id> [--lookup ... --season ... --instrument ... --performer ... --status ...]
dex catalog manifest retire --entry <slug|href|id>
dex catalog manifest remove --entry <slug|href|id> [--force-remove]
```

Other catalog operations:
```bash
dex catalog stage --entry <slug|href|id> [--lookup ...]
dex catalog spotlight set --entry <slug|href|id> [--headline ... --cta-label ...]
dex catalog validate
dex catalog diff --env test|prod
dex catalog publish --env test|prod [--dry-run]
dex catalog pull --env test|prod
```

Catalog seasons:
```bash
dex catalog seasons list
dex catalog seasons get --season S2
dex catalog seasons set --season S3 --label "season 3 ('26-)" --order 3
dex catalog seasons teaser enable --season S3
dex catalog seasons teaser disable --season S3
dex catalog seasons teaser set --season S3 --count 1 --message "this artist has not been announced yet" --tokens "???,!!!,***,@@@" --style redacted
```

### `dex home`
Usage:
```bash
dex home <featured|validate|diff|publish|pull> [args]
```

Commands:
```bash
dex home featured list
dex home featured set --entries <id1,id2,...>
dex home featured reorder --entries <id1,id2,...>
dex home validate [--catalog-file data/catalog.editorial.json]
dex home diff --env test|prod
dex home publish --env test|prod [--dry-run]
dex home pull --env test|prod
```

### `dex notes`
Usage:
```bash
dex notes <list|add|edit|set|build|validate|publish> [args]
```

Commands:
```bash
dex notes list
dex notes add [--title ... --slug ...]
dex notes edit --slug <slug>
dex notes set --slug <slug> --field <frontmatter-key> --value <value> [--json]
dex notes build
dex notes validate
dex notes publish
```

### `dex polls`
Usage:
```bash
dex polls <validate|create|edit|close|open|publish> [args]
```

Commands:
```bash
dex polls validate [--file data/polls.json]
dex polls create [--question ...] [--visibility public|members] [--status draft|open|closed] [--file ...]
dex polls edit <pollId> [--question ... --visibility ... --status ... --closeAt ... --manualClose true|false --file ...]
dex polls close <pollId> [--file ...]
dex polls open <pollId> [--file ...]
dex polls publish --env test|prod [--file ...]
```

### `dex newsletter`
Usage:
```bash
dex newsletter <templates|preview|draft|test-send|schedule|send|stats|segment-estimate|import> [args]
```

Commands:
```bash
dex newsletter templates
dex newsletter preview --template newsletter [--vars '{"k":"v"}' | --vars-file ./vars.json] [--out ./tmp/file.html] [--open true|false]
dex newsletter draft list [--limit 50]
dex newsletter draft create --template newsletter [--vars ...|--vars-file ...] [--name ...] [--segment ...] [--subject ...] [--preheader ...]
dex newsletter draft edit --id <campaignId> [--name ... --subject ... --preheader ... --segment ... --template ... --vars ... --vars-file ...]
dex newsletter test-send <campaignId> --to you@example.com
dex newsletter schedule <campaignId> [--at 2026-03-01T18:00:00.000Z]
dex newsletter send <campaignId>
dex newsletter stats <campaignId>
dex newsletter segment-estimate [--segment all_subscribers]
dex newsletter import --csv ./subscribers.csv [--source mailchimp] [--consent-mode verified]
```

### `dex assets`
Usage:
```bash
dex assets <validate|diff|publish|bucket> [args]
```

Commands:
```bash
dex assets validate [--file data/protected.assets.json] [--env test|prod]
dex assets diff --env test|prod [--file data/protected.assets.json] [--api-base ...] [--token ...]
dex assets publish --env test|prod [--dry-run] [--file data/protected.assets.json] [--api-base ...] [--token ...]
dex assets bucket ensure --env test|prod [--name dex-protected-assets] [--dry-run] [--api-base ...] [--token ...]
```

### `dex release`
Usage:
```bash
dex release preflight [--env test|prod]
dex release publish [--env test|prod] [--dry-run] [--no-preflight]
```

Publish override flags:
- `--api-base` (shared)
- `--token` (shared)
- `--assets-api-base`
- `--assets-token`
- `--catalog-api-base`
- `--catalog-token`

Release publish order:
1. preflight (unless `--no-preflight`)
2. assets publish
3. catalog publish
4. local snapshot sync (non-dry-run)

### `dex deploy`
Usage:
```bash
dex deploy [--remote origin] [--no-set-upstream] [--no-preflight] [--preflight-env test|prod]
```

Policy:
1. For production, do not use `--no-preflight`.
2. Preferred production command:
```bash
dex deploy --preflight-env prod
```

### `dex view`
Purpose: launch local HTML viewer for generated entries.

Usage:
```bash
dex view [--open|--no-open] [--port <number>] [--root <path>]
```

Examples:
```bash
dex view
dex view --no-open --port 8080
dex view --root ./entries
```

### `dex setup`
Usage:
```bash
dex setup [--reset] [--repo site|api]
```

### `dex status`
Purpose: open status incident manager in TUI.

Notes:
1. `status` is an interactive manager (incident create/resolve/page regen).
2. Use dashboard for safest operation and visibility.

## TUI Command Centers + Keybindings

Danger levels:
1. `SAFE`: read/inspect.
2. `EDIT`: local file mutations.
3. `PUBLISH`: live publish/deploy side effects.

### Global
1. `Ctrl+Q`: quit Dex.
2. `Enter`: run selected command.
3. `Up/Down`: move cursor.
4. `?`: command palette.
5. `Esc`: back/exit current manager.

### Dashboard
1. `Enter`: open selected menu command (`SAFE`).
2. `Up/Down`: menu navigation (`SAFE`).
3. `?`: open/close command palette (`SAFE`).
4. In palette:
- `Up/Down`: navigate results.
- `Backspace/Delete`: edit query.
- `Enter`: run selected command.
- `Esc`: close palette.

### Init wizard
1. Global in wizard:
- `Enter`: next step.
- `Esc`: previous step / cancel.
- `Ctrl+Q`: quit.
2. List-style fields:
- `Ctrl+A`: add item.
- `Ctrl+D`: remove last item.
3. Download step:
- `Ctrl+I`: recording index import mode.
- `Ctrl+P`: paste mode.
- `Ctrl+G`: cycle channel view.
- `Tab`: cycle focus panes (`rows/pdf/bundle/source/segments`).
- `Up/Down`: segment and row navigation.
4. Tags step:
- type to filter.
- `Space`: toggle tag.
- `Up/Down`: move tag cursor.

### Update wizard
1. Checklist stage:
- `Space`: toggle section.
- `Enter`: continue.
- `Esc`: back.
2. Edit stage:
- type/paste to edit current field.
- `Up/Down`: switch fields.
- `Ctrl+I`: import recording index from source URL.
- `Enter`: continue.
- `Esc`: back.
3. Review stage:
- `Ctrl+S`: save and regenerate.
- `Esc`: back.

### Doctor
1. `Up/Down`: select entry report (`SAFE`).
2. type: filter slugs (`SAFE`).
3. `Ctrl+S`: repair selected (`EDIT`).
4. `Esc`: back.

### Entry Audit
1. `Up/Down`: select inventory row (`SAFE`).
2. `r`: rerun audit (`SAFE`).
3. `Esc`: back.
4. Right pane shows download tree/coverage model for selected row.

### Catalog Manager
1. `m`: toggle `full/staged` rows (`SAFE`).
2. `a`: stage manifest entry (`EDIT`).
3. `s`: set spotlight (`EDIT`).
4. `v`: validate + snapshot (`EDIT`).
5. `d/f`: diff test/prod (`SAFE`).
6. `p`: publish test (`PUBLISH`).
7. `o`: publish prod with typed confirmation phrase (`PUBLISH`).
8. `l/k`: pull test/prod (`EDIT`).
9. `r`: reload (`SAFE`).
10. `Esc`: back.

### Home Featured Manager
1. `a`: set featured entries list (`EDIT`).
2. `e`: reorder featured entries (`EDIT`).
3. `v`: validate + snapshot (`EDIT`).
4. `d/f`: diff test/prod (`SAFE`).
5. `p`: publish test (`PUBLISH`).
6. `o`: publish prod with typed confirmation (`PUBLISH`).
7. `l/k`: pull test/prod (`EDIT`).
8. `r`: reload (`SAFE`).
9. `Esc`: back.

### Protected Assets Manager
1. `v`: validate coverage (`SAFE`).
2. `d/f`: diff test/prod (`SAFE`).
3. `p/o`: publish test/prod (`PUBLISH`).
4. `b/n`: ensure bucket test/prod (`PUBLISH`).
5. `r`: reload (`SAFE`).
6. `Up/Down`: lookup navigation (`SAFE`).
7. `Esc`: back.

### Polls Manager
1. `n`: create poll (`EDIT`).
2. `e`: edit selected poll (`EDIT`).
3. `o/c`: open/close poll (`EDIT`).
4. `r`: refresh selected metrics (`SAFE`).
5. `Shift+R`: reload polls file (`SAFE`).
6. `m`: refresh all metrics (`SAFE`).
7. `t/p`: publish test/prod (`PUBLISH`).
8. Editor mode:
- `Up/Down`: move fields.
- `Enter`: edit text field.
- `Left/Right`: cycle enum values.
- `Space`: toggle bool.
- `S` or `Ctrl+S`: save.
- `Esc`: close/cancel.

### Newsletter Manager
1. `n`: create draft.
2. `a`: cycle audience.
3. `s`: schedule `+5m`.
4. `x`: send now.
5. `t`: test send.
6. `g`: fetch stats.
7. `p`: preview.
8. `k`: cycle template seed.
9. `r`: refresh campaigns.
10. `Up/Down`: campaign selection.
11. `Esc`: back.

### Dex Notes Manager
1. `a`: add post draft wrapper (`dex notes add`) (`EDIT`).
2. `e`: edit selected post in `$EDITOR` (`EDIT`).
3. `t`: set selected title (`EDIT`).
4. `b`: build notes (`EDIT`).
5. `v`: validate notes (`SAFE`).
6. `r`: reload (`SAFE`).
7. `Up/Down`: select post.
8. `Esc`: back.

### Status Manager
1. `n`: new incident (`EDIT` + publish event side effects).
2. `r`: resolve selected incident (`EDIT` + publish event side effects).
3. `g`: regenerate selected incident page (`EDIT`).
4. `u`: reload runtime status data (`SAFE`).
5. Editor mode:
- `Up/Down`: move fields.
- `Enter`: edit text.
- `Left/Right`: cycle enum.
- `S`/`Ctrl+S`: save.
- `Esc`: close/cancel.
6. `Esc`: back.

## Canonical Production Workflows

### Workflow 1: Create and validate a new entry
1. Launch dashboard:
```bash
dex
```
2. Run `Init` and complete all steps.
3. Run `Entry Audit` from dashboard or:
```bash
dex entry audit --slug <slug>
```
4. If inventory mismatch appears, run:
```bash
dex entry audit --slug <slug> --inventory-only
```
5. Stop condition:
- any `FAIL` in runtime audit,
- any download tree critical issues,
- unresolved token/lookup mismatches.

### Workflow 2: Validate assets + catalog/home curation
1. Validate protected assets:
```bash
dex assets validate
```
2. Validate catalog and home featured:
```bash
dex catalog validate
dex home validate
```
3. Diff test env before publish:
```bash
dex assets diff --env test
dex catalog diff --env test
dex home diff --env test
```
4. Stop condition:
- missing coverage for active lookups,
- linkage validation failures,
- snapshot validation errors.

### Workflow 3: Preflight and publish (test then prod)
1. Test preflight:
```bash
dex release preflight --env test
```
2. Test publish:
```bash
dex release publish --env test
```
3. Production preflight:
```bash
dex release preflight --env prod
```
4. Production publish:
```bash
dex release publish --env prod
```
5. Deploy site:
```bash
dex deploy --preflight-env prod
```
6. Stop condition:
- any preflight failure,
- missing active lookup coverage,
- generated HTML secure check failure.

### Workflow 4: Notes editorial ship
1. Edit note:
```bash
dex notes edit --slug <slug>
```
2. Validate:
```bash
dex notes validate
```
3. Publish notes bundle:
```bash
dex notes publish
```

## Security + Secrets + Ownership

### Repo ownership boundaries
1. `dexdsl.github.io` (this repo):
- authoring, catalog/home/data manifests, entry HTML generation, publish orchestration.
2. `dex-api` repo:
- Worker endpoints, D1 writes/reads, secret-backed admin/user APIs.

### Worker/admin secrets (set in `dex-api` with Wrangler)
Environment-specific:
- `DEX_ASSETS_ADMIN_TOKEN_TEST`
- `DEX_ASSETS_ADMIN_TOKEN_PROD`
- `DEX_CATALOG_ADMIN_TOKEN_TEST`
- `DEX_CATALOG_ADMIN_TOKEN_PROD`

Recommended shared baseline aliases:
- `DEX_ASSETS_ADMIN_TOKEN`
- `DEX_CATALOG_ADMIN_TOKEN`

### Local shell environment (site repo command execution)
1. Export admin tokens before diff/publish from this repo if not already configured in your shell profile.
2. Never commit secrets into repo files.

### High-risk flags policy
1. `dex deploy --no-preflight` is emergency-only.
2. `dex release publish --no-preflight` is emergency-only.
3. `dex catalog manifest remove --force-remove` bypasses linkage safety; use only with explicit approval.

## Troubleshooting Playbooks

### Workspace setup canceled or missing
Symptom:
- Dex prints workspace config errors or exits to setup guidance.

Fix:
```bash
dex setup --reset
```

### TUI command says TTY required
Symptom:
- `dex init`, `dex update`, `dex status`, or dashboard features refuse to run in non-interactive shell.

Fix:
1. Run in an interactive terminal.
2. Use direct non-TTY alternatives only where supported (`entry audit`, `assets validate`, etc.).

### Preflight fails on missing protected coverage
Symptom:
- `preflight failed: missing protected asset coverage (...)`

Fix:
1. Inspect:
```bash
dex assets validate
dex entry audit --all --inventory-only
```
2. Add mappings in protected assets manager.
3. Re-run preflight.

### Entry audit runtime/token failure
Symptom:
- `FAIL <slug>` in `dex entry audit`
- invalid token or missing recording index refs.

Fix:
1. Open `Update` wizard for slug.
2. Correct lookup tokens and recording index refs.
3. Re-run:
```bash
dex entry audit --slug <slug>
```

### Admin token/env mismatch
Symptom:
- publish/diff auth failures against Worker admin endpoints.

Fix:
1. Confirm you are using correct env (`test` vs `prod`).
2. Confirm corresponding token variable is exported in shell.
3. Confirm token secret exists in Worker environment.

## Verification and CI Gates

### Local verification commands
1. Manual contract:
```bash
npm run verify:dex-manual
```
2. Full gate:
```bash
npm run phase1:all
npm run sanitize:all
```

### What preflight enforces
`dex release preflight` currently checks:
1. entry runtime audit,
2. protected asset coverage for active catalog lookups,
3. catalog validation,
4. generated HTML secure checks.

## Appendix: Command Equivalents (TUI <-> CLI)

### Entry flows
1. TUI `Entry Audit` <-> CLI:
```bash
dex entry audit --all
```
2. TUI `Init` <-> CLI:
```bash
dex init
```
3. TUI `Update` <-> CLI entrypoint:
```bash
dex update
```

### Content flows
1. TUI `Catalog` publish test/prod <-> CLI:
```bash
dex catalog publish --env test
dex catalog publish --env prod
```
2. TUI `Home` publish test/prod <-> CLI:
```bash
dex home publish --env test
dex home publish --env prod
```
3. TUI `Notes` build/validate <-> CLI:
```bash
dex notes build
dex notes validate
```

### Infrastructure flows
1. TUI `Assets` validate/publish <-> CLI:
```bash
dex assets validate
dex assets publish --env test
dex assets publish --env prod
```
2. TUI deploy shortcut <-> CLI:
```bash
dex deploy --preflight-env test
dex deploy --preflight-env prod
```

## How to update this manual safely

1. Update command docs and keybinding sections in this README.
2. Run:
```bash
npm run verify:dex-manual
```
3. Run broader gates:
```bash
npm run phase1:all
npm run sanitize:all
```
4. If verifier fails, add missing sections/markers rather than weakening checks unless command surface changed in code.
