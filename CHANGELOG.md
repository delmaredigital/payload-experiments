# Changelog

All notable changes to this workspace are documented here, per package.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and both packages adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### stats

### plugin

- Added Goals list and form pages inside Tests, reached through the "Manage goals" link. Migration impact: none.
- Centralized admin theme tokens and moved Tests above collection groups, after any host-provided leading navigation links.
- Audience list rules without fixed values now use keyboard-accessible chips and save arrays; fixed value lists keep their checkboxes, and existing comma-separated values remain readable.
- Styled the Puck Experiment block header, warning, version tabs, selected-version copy action, empty drop zones and creation panel for host editor resets and both admin themes. The self-contained stylesheet is exported as `@delmaredigital/payload-experiments/puck/editor.css`. Hosts must load it inside the editor iframe: in the CSS that builds the iframe stylesheet, add `@import "@delmaredigital/payload-experiments/puck/editor.css";` after `@import "tailwindcss";`. Alternatively, serve the exported file and append its URL to payload-puck's `editorStylesheets`, after the host stylesheet. The client import alone does not reach an iframe with `syncHostStyles: false`. A block already linked to a test no longer offers "Test this block"; it links to "Set up the test" while the test is a draft and to "View results" afterwards.

Migration impact: none. The Tests import-map path is unchanged.

## [0.2.0-rc.3] - 2026-11-02

### plugin

**Fixed**

- Start and the other actions failed with 'The following field is invalid: Experiment' on hosts with numeric ids.
- The Tests home failed to load summaries when the browser or server encoded the comma in the ids list.

Migration impact: none. Host step: update the package pin; no other action is needed when upgrading from rc.2. The importMap is unchanged.

## [0.2.0-rc.2] - 2026-11-02

### plugin

**Fixed**

- Fixed `next build` failing on Next 16 for hosts whose route handlers or Payload config import `/rsc`, with "Could not parse module … app-route/vendored/contexts/app-router-context.js". In 0.2.0-rc.1, `/rsc` re-exported the Tests server views, which import `next/navigation`. The views now live on `@delmaredigital/payload-experiments/admin/rsc`; `/rsc` is route-handler-safe again and an import-graph test keeps it so.

### BREAKING

- `ExperimentsRootView`, `CollectionListRedirect` and `CollectionEditRedirect` moved from `/rsc` to `/admin/rsc`. Update direct imports and run `payload generate:importmap` after upgrading: the admin path constants changed.
- Migration impact: none.

## [0.2.0-rc.1] - 2026-11-02

### plugin

**Added**

- A full-screen Tests admin surface at `/admin/experiments`, reached from a single "Tests" navigation link: a home that groups tests (needs attention, running, ready to start, draft, decided, archived), a New test flow (a block on a page, or a setting), one test page with plain-language sections and an Advanced disclosure, a readiness banner that names the next step, and results with a recommendation sentence and Decide. Puck's Experiment block offers "Test this block" to create a test from the page.
- `ResultsResponse.decision` lets results readers without manage access see the winner.
- `verdict.worstArm` identifies the worse version on snapshots computed from this version.
- Optional `admin.editorUrl`, `admin.previewUrl` and `admin.descriptions` host configuration, validated at registration and kept server-side.
- Optional `FlagPoint.description` for setting help text.
- `summary.ready` for draft and stopped tests when the caller can manage tests, using shared readiness reads across the batch.
- Block preflight placements include optional `url` and `editorUrl` host links and per-slot content counts in `slots`.
- Public `ReadinessCode` type covering the 28 readiness checks.

**Changed**

- The old experiments edit-form components are no longer mounted. Goals and Test groups fields now have plain-language labels and descriptions.
- New tests default to a 28-day planned duration. Preflight suggests a duration from power and reach even when a duration is saved.
- Experiments list, edit and results routes hand over to the new Tests views. Experiments, layers and metrics leave the admin navigation while their routes remain reachable.
- Metrics are labelled Goals; layers are labelled Test groups (advanced).
- Experiment versions are capped at 50 per test.

**Fixed**

- Start stays disabled, with the reason shown, until a test can start; the readiness banner names the next step. Previously Start could be pressed and then refused without a reason.

**Removed**

- The `listSummary` list column and these `/admin/client` exports: `StatusCell`, `SummaryCell`, `ExperimentActions`, `LockedFieldNotice`, `FlagPointSelect`, `ArmsField`, `AllocationField`, `TargetingAttributeField`, `TargetingOpField`, `TargetingValueField`, `ReviewPanel`, `PhaseHistory`, `ResultsView`.

**Migration impact**

- None (no column changes). At the release commit, regenerating the schema fixture and restoring its provenance header leaves `git diff --stat -- tests/_fixtures/generated-schema.ts` with no output.

### BREAKING

- `/admin/client` no longer exports `StatusCell`, `SummaryCell`, `ExperimentActions`, `LockedFieldNotice`, `FlagPointSelect`, `ArmsField`, `AllocationField`, `TargetingAttributeField`, `TargetingOpField`, `TargetingValueField`, `ReviewPanel`, `PhaseHistory` or `ResultsView`. Run `payload generate:importmap` and commit the regenerated import map; any host code importing these names must drop them. The Tests surface is registered through `admin.dependencies`, so without the regenerated import map the Tests routes show a 'not installed' message instead of the Tests screen.

## [0.1.0-rc.7] - 2026-11-01

### plugin

**Fixed**

- Flag experiments created by a request without manage access (migrations, scripts) no longer roll back the caller's transaction: the flag-params hook read xp-state with access checks, and Payload killed the transaction on Forbidden before the hook swallowed the error.
- The layers beforeDelete hook reads referencing experiments without a second access check, so a refused nested read cannot kill the caller's transaction or hide a referencing experiment. Read errors propagate and abort the delete.

**Migration impact**

- None.

## [0.1.0-rc.6] - 2026-11-01

### plugin

**Fixed**

- The release workflow builds the whole workspace before packing, so the plugin's
  declaration build finds the stats package.
- 0.1.0-rc.4 and 0.1.0-rc.5 were tagged but never reached npm; their changes first
  ship in this version.

**Migration impact**

- None.

## [0.1.0-rc.5] - 2026-11-01

### plugin

**Fixed**

- CI typecheck passes on Linux; the admin arm-select test fixture now declares
  `hideGutter`. Test-only, no runtime change.
- 0.1.0-rc.4 was tagged but never published (the Linux typecheck failed before
  the publish job ran); its changes first ship in this version.

**Migration impact**

- None.

## [0.1.0-rc.4] - 2026-11-01

### plugin

**Added**

- Object-form `eventSources` entries (`{ name, clientWritable }`) so a server-only
  event can be a metric without accepting browser writes.

**Fixed**

- The plugin package now exports `./package.json`.

**Migration impact**

- None. Bare-string `eventSources` entries keep their existing behavior.

## [0.1.0-rc.3] - 2026-10-31

### plugin

**Fixed**

- A content slot with no running experiment now renders exactly as it does with
  experiments turned off, with no extra wrapper element around its content.

**Migration impact**

- None.

## [0.1.0-rc.2] - 2026-10-31

### plugin

**Added**

- Optional frozen exposure dimensions from server-computed request attributes
  (`events.dimensions`), and retention batches indexed by experiment, event type and time.
- Experiment actions: decide a winner, release a holdout, and archive a stopped
  experiment or a decided experiment after making the winner permanent, discarding
  it, or confirming that a developer has hard-coded a code experiment's winner.
  Delete draft or archived experiments with their rounds, events and results snapshots.
- Permanent content: make the winner permanent for block, flag and page experiments.
  Blocks replace experiment slots with the winning content; flags keep the winning
  defaults and can update host content; pages keep serving the winner with its
  canonical URL. Pages that are localized, have hidden fields, or have fields the
  manager cannot read or update are refused individually, with a report of pages
  that still need a hand edit.
- Results: `runResults` from `/rsc` for a host-owned cron route, with a time budget
  that bounds waiting for hung metric sources and database connections; results,
  experiment-summary and recompute endpoints supply the admin's results and list
  summaries.
- Analysis: frequentist inference with sequential testing, Bayesian comparisons,
  CUPED variance reduction, guardrails, sample-ratio mismatch (SRM) checks, power
  estimates and plain-English verdicts.
- Retention: by default, events are deleted 180 days after an experiment's final
  round ends, never while any round is open.
- Content-change tracking: `captureContentBaseline` from `/rsc` for draft-enabled
  host collections outside Puck; publish markers compare with the previously
  published content, including the first publish of a page created as a draft.

**Changed**

- Input refusals: 400 is reserved for requests that cannot be parsed against the
  declared schema; well-formed requests that cannot be accepted receive 422 with
  a distinct refusal code. New codes are `undeclared-targeting-key`,
  `invalid-targeting-rule`, `duplicate-metric`, `unknown-metric-source`,
  `too-many-ids`, `invalid-phase`, `invalid-ids` and `recompute-failed`.
- Verdicts recommend the variant with the larger improvement in the metric's
  direction, including metrics where lower is better.

**Migration impact**

- Since rc.1: new nullable `xp-events.dimensions` JSON column and composite
  `(experiment_id, type, ts)` retention index. The host runs `payload migrate:create`, then
  `payload migrate` for rc.2.
- Hosts that declare a `staff` attribute must create their server runtime with
  `defineExperimentsServerRuntime` and pass an `attributesOf` function; startup
  refuses the configuration without it.

**Known gaps**

- Exposure dimensions can be recorded, but results cannot yet be broken down by
  those dimensions.

## [0.1.0-rc.1] - 2026-10-31

### plugin

**Added**

- Data and access: experiment, round, layer, metric, event, identity and results
  snapshot collections, plus the experiment state global. Required `access.manage`
  and configurable `readResults` permissions, with every access operation explicit.
- Manifest: compiled experiment configuration, revision-based caching, a protected
  manifest endpoint, and Postgres and HTTP loaders.
- Next.js runtime: `createExperimentProxy`, `resolveExperiments` and
  `applyExperiments`; signed `xp_id` cookies, `x-xp-assignments` and `x-xp-request`
  headers; consent handling, preview links and whole-page rewrites.
- Server readers and writes from `/rsc`: `getAssignments`, `resolveExperimentData`,
  `getFlagPoint`, `toClientAssignments`, `recordExposures`, `trackConversion`,
  `linkIdentity`, `eraseUser`, `recordContentChange`, `experimentMetadata` and
  `experimentSitemapFilter`. Exposure logging counts rendered content rather than
  assignment alone.
- Client integration: `ExperimentsProvider`, `useFlagPoint`, `useExperiment`,
  `ExperimentPageview` and `trackConversionBeacon`, with explicit exposure calls
  and allow-listed client assignments.
- Events: `POST /xp/events` verifies signed cookies, recomputes assignments before
  accepting exposures, restricts conversions to client-writable sources, limits
  request size and supports the host's rate limiter.
- Experiment actions: start, raise allocation, add a supporting metric or
  guardrail, and stop; setup preflight checks and preview-token endpoints.
- Puck and host content: `ExperimentSlot`, `ExperimentSlotEditor`,
  `createExperimentSlotField` and `createArmSelectField`; content-change recording
  on publish, installed host hooks that never throw, and `puck.collections`
  registrations accepting `{ slug, field? }` for custom content fields.
- Admin: What, Who, Groups, Metrics and Review tabs; typed targeting and group
  fields, setup checks, placements, preview links and duration estimates. Status
  cells, round history, layer usage, action confirmations and a Results view with
  group comparisons, data-quality details and charts are available. Results and
  list summaries still need the results services listed below.

**Migration impact**

- Initial schema: the host runs `payload migrate:create`, then `payload migrate`.
  Collections: `xp-experiments`, `xp-phases`, `xp-layers`, `xp-metrics`, `xp-events`,
  `xp-identities` and `xp-results-snapshots`. Global: `xp-state`.

**Known gaps**

- Deciding a winner, releasing a holdout, archiving and deleting experiments are
  not available yet.
- Making the winner permanent content is not available yet.
- Computed results are not available yet: the results run (`runResults`) and the
  results, recompute and experiment-summary endpoints are still to come, so the
  admin cannot show computed results or list summaries.

## [0.1.0] - 2026-10-30

### stats

- Initial engine: assignment, statistics/CUPED, sequential and Bayesian tests,
  SRM, mid-experiment and pre-experiment power, capping/aggregation, parity
  harness and drift job.
