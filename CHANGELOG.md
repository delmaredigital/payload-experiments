# Changelog

All notable changes to this workspace are documented here, per package.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and both packages adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### stats

### plugin

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
