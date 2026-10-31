# Changelog

All notable changes to this workspace are documented here, per package.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and both packages adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### stats

### plugin

**Added**

- Optional frozen exposure dimensions from server-computed request attributes
  (`events.dimensions`), and an index-served retention sweep on events.

**Migration impact**

- Since rc.1: new nullable `xp-events.dimensions` JSON column and composite
  `(experiment_id, ts)` index for ordered retention batches. The host runs `payload migrate:create`, then
  `payload migrate` for rc.2.

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
