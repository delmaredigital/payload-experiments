# Changelog

All notable changes to this workspace are documented here, per package.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and both packages adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### stats

### plugin

- Fixed: page saves and deletes cannot remove a running block test's last placement. The guard uses Start's published-and-draft placement scan, applies to both editors and API writes, and returns a public sentence naming the test. Draft saves keep counting the published block; unpublishing with the block intact keeps a draft placement.
  Migration impact: none.

- Added: Configure test in the Puck canvas and sidebar opens shared setup and results in a right drawer with zero host wiring. The private, uncached `/xp/editor-surface` endpoint returns the requesting user's admin surface configuration. Version labels summarize canvas versions; shares remain editable. Saves and transitions refresh bound blocks without reloading the page.
  Migration impact: none.
- Fixed: test block headers can initiate dragging, non-interactive chrome selects once, controls stay isolated, and running-test detach checks fresh placements before offering and confirming removal.
  Migration impact: none.

## [0.4.0-rc.3] - 2026-11-07

### plugin

- Fixed: Puck publish refusals name the invalid click goal and its block in the Save Failed dialog, while preserving Payload's field-level errors.
  Migration impact: none.
- Fixed: Advanced on the goal form and the test page now opens in the same update as the error that needs it.
  Migration impact: none.
- Fixed: A duplicate short name on a non-click goal now points to the Short name field, not to Advanced.
  Migration impact: none.
- Changed: README rewritten for the people who install and use it; full reference kept in REFERENCE.md until the docs site.
  Migration impact: none.

## [0.4.0-rc.2] - 2026-11-07

### plugin

- Changed: choosing a page in the new-test wizard and in a test's Versions now uses one searchable field that shows the chosen page.
  Migration impact: none.
- Changed: Tests and Goals appear as a regular "Tests" nav group, the first named group, visible to managers only. The nav highlights on the Tests home and Goals page; on deeper test pages the surface breadcrumbs show where you are.
  Import-map keys changed: added `@delmaredigital/payload-experiments/admin/rsc#TestsCollectionListView`, `@delmaredigital/payload-experiments/admin/rsc#GoalsCollectionListView`, `@delmaredigital/payload-experiments/admin/rsc#GoalEditRedirect`; no longer referenced: `@delmaredigital/payload-experiments/admin/rsc#CollectionListRedirect`, `@delmaredigital/payload-experiments/admin/rsc#TestsNavLinkServer`, `@delmaredigital/payload-experiments/admin/client#TestsNavLink`, `@delmaredigital/payload-experiments/admin/client#TestsDashboardCards`. Hosts must regenerate their import map; without regeneration, Payload falls back to its raw `DefaultListView` table at both collection URLs, and `/collections/xp-metrics/create` and `/collections/xp-metrics/<id>` show Payload's raw Goal form. The old exports remain until 0.5.0.
  Migration impact: none; regenerate the import map; generated types reorder only. Host `migrate:create` diffs by name, so this collection-order change is a no-op.
- Fixed: Copy the Original, and other version changes in the block panel, failed when a version or any block on the page held an empty list.
  Migration impact: none.
- Changed: Unwrap follows the test's status, with draft deletion, stopped-test confirmation, and specific error text when a change fails.
  Migration impact: none.
- Fixed: click-goal field layout in the admin and contrast in the page editor's field sidebar when the admin is in dark mode. Sidebar styling keys off Puck's field-panel class, checked by a test against the installed Puck.
  Migration impact: none.
- Fixed: Publishing a Puck page whose components name a click goal that does not exist is now refused, with the component's location and "No click goal has this name yet. Create it with "+ New click goal"." Draft saves are still allowed, matching Payload block fields. The check runs for managers (`access.manage`); a malformed goal name is refused for everyone. On a Puck collection without drafts every save is checked.
  Migration impact: none in code. A page that already names an undefined click goal cannot be published by a manager until the goal is created or the name is removed.
- Fixed: Start and Decide on a stopped block test whose Experiment block was removed from its page are refused with "The block for this test was removed from its page, so it can't start again. Its results are kept. To test the block again, start a new test from the page." (new refusal code `placement-removed`). Archive still works.
  Migration impact: none. Hosts that switch over refusal codes gain `placement-removed`.
- Fixed: REST errors from the tests collection keep their refusal `code` for every refusal, not only `stale-edit`, so the admin shows the specific message (for example deleting a test that is no longer a draft, `invalid-status`, 409).
  Migration impact: none.
- Corrected (0.4.0-rc.1 entry): `admin.editorUrl` now receives a required `editor` argument (`'puck' | 'blocks' | 'page'`) as well as `doc`. A host that types its own `editorUrl` function, or calls it in tests, must accept or pass `editor`. The rc.1 entry said "Migration impact: none"; that was wrong.
  Migration impact: TypeScript hosts update the `editorUrl` signature and any direct callers; runtime behaviour is unchanged.

## [0.4.0-rc.1] - 2026-11-05

### plugin

- Changed: `TestsSurfaceProps` accepts optional `collectionTitles`, `userId` and `userCollection` so plugin pages no longer depend on Payload UI. Migration impact: none; the root view fills these props.
- Added: the Goals page creates click goals with "A click on the page", with their short name under Advanced. Migration impact: none.
- Added: goal pickers group defined goals found on the test's page under "On this test's page", with a note explaining that linked-document and code goals are not listed. Migration impact: none.
- Added: `xpGoalField()` has a manager picker with inline "+ New click goal" creation and a warning for undefined keys. Migration impact: new importMap component key (`XpGoalField`). Run `payload generate:importmap`.
- Added: `xpGoalPuckEditorField()` from `/puck/editor` provides the click-goal picker and inline creation for the Puck sidebar. Migration impact: use it in editor configs, with `xpGoalPuckField()` from `/puck` in render configs; no database change.
- Added: each results round with a click primary goal explains that clicks show interest and suggests adding the desired outcome as another goal. Migration impact: none.
- Added: manager-only `GET /xp/pages` accepts an optional `path` query to resolve a page's title and document link. Migration impact: none.
- Added: readiness, add-goal warnings and results name and link page and block placements when they can be resolved. Migration impact: none.
- Changed: `PhaseSummary.metrics[]` gains optional `clickGoal: true`, derived from the round's frozen goal definition. Migration impact: readers may adopt the optional marker; no database change.
- Added: `experimentsPuck()` and `experimentsPuckEditor()` bundle the test block, its sidebar category and the outline plugin into one object per side for payload-puck 0.10.3's `integrations`; the separate pieces stay exported. Migration impact: none; hosts opt in by passing the objects to `integrations`.
- Added: click goals (`click:<short-name>`), delegated client click beacons, defined-key validation and published-content fairness checks at Start, add-goal and results runs. Click goals may be primary or guardrail goals. Migration impact: no plugin database change; render `data-xp-goal` on the host's interactive elements when adopting click goals.
- Added: `xpGoalField()` from the package root and `xpGoalPuckField()` from `/puck` mark interactive content with click-goal keys. Migration impact: hosts adopting the Payload field add one nullable text column per table using `xpGoal`, including version tables, with `payload migrate:create`; the Puck prop adds no column.
- Added: `AddMetricWarning`, `AddMetricResult` and `ClickKeysResult` types from the package root, and manager-only `GET /xp/experiments/:id/click-keys`. Migration impact: no database change; hosts may adopt the typed response and key discovery endpoint.
- Changed: `/client` assignments support optional `clickGoalsArmed`, supplied by `toClientAssignments` from `/rsc`. Migration impact: no database change; hosts constructing client assignments may adopt the optional field.
- Changed: `onInit` refuses host `metricSources` ids starting with the reserved `click:` prefix. Migration impact: rename any registered source using that prefix before upgrading.
- Changed: `ReadinessCode` and `RefusalCode` gain `goal-in-some-versions` and `placement-unchecked`. Migration impact: update exhaustive switches and records over these unions; no database change.
- Changed: `Snapshot` gains optional `goalFairnessNotice`, and `PreflightResult` gains optional `goalNotes`. Migration impact: readers may display the notices; no database change.
- Changed: add-metric responses always include `warnings` (`goal-in-some-versions`, `goal-added-mid-test` and `placement-unchecked`); the add-goal dialog displays them, and asymmetric guardrail click goals are refused with `goal-in-some-versions`. Migration impact: handle warnings and the new refusal when calling add-metric; no database change.
- Changed: the Goals "Measured by" list (`serializeMetricSources`) offers "A click on the page". Migration impact: no database change; hosts can adopt click goals without registering a metric source.
- Changed: publishing with an undefined `xpGoal` key is refused by field validation, as are draft saves when the collection validates drafts (`versions.drafts.validate`). Migration impact: define the click goal before publishing content that uses its key (or saving a validated draft); no plugin database change.
- Changed: clicks before a goal was added mid-test are excluded from that goal's results for every version. Migration impact: no database change; historical clicks before the add do not contribute to the newly added goal.
- Added: an "A whole page" test card that walks through choosing the Original and a page for each version, a page picker on whole-page tests, and step-by-step copy instructions (or the host's `copyHint`). Migration impact: none.
- Added: "A block on a page" lists pages edited with a `blocks` field too. Migration impact: none.
- Added: "Test a block on this page" for `blocks` collections, and the Experiment block's status line, version labels, "Copy the Original into this version", version sync, and Unwrap. Migration impact: no database columns; new importMap component keys (`TestBlockField`, `BlockStatusField`, `BlockSlotRowLabel`, `CopyOriginalField`). Run `payload generate:importmap`.
- Added: Experiment blocks for registered Payload blocks fields, with Original/version rendering, viewport groups, draft wrapping and winner replacement in published content and drafts. Migration impact: hosts adopting `createExperimentBlock` add the Experiment block and slots tables, their version tables, and the live/version `slot` enum types (`enum_<coll>_blocks_<slug>_slots_slot` and its `_v` counterpart) with `payload migrate:create`.
- Added: the package root exports `createExperimentBlock`, and `/blocks` exports `controlOnlyBlocks`, `segmentExperimentBlocks` and `EXPERIMENT_BLOCK_SLUG` for host blocks fields. Migration impact: import `createExperimentBlock` from the package root and the helpers from `/blocks`; no additional database change.
- Added: `resolveExperimentBlocks` from `/rsc` resolves versions and rendered exposures for host block rendering. Migration impact: wire the resolver into the host renderer; no database change.
- Added: `ExperimentGroup` from `/client` provides viewport exposure groups. Migration impact: wrap resolved viewport groups in the host renderer; no database change.
- Added: manager-only `POST /xp/blocks/wrap` wraps a block in the latest draft, respects document locks and caps requests at 16 KiB. Migration impact: none.
- Added: form-state helpers `wrapExperimentBlock`, `syncExperimentSlots`, `copyOriginalIntoVersion`, `unwrapExperimentBlock` and `findRegisteredBlocksField` from `/admin/client`. Copy helpers take field config to refresh only array and blocks row ids. Migration impact: pass the registered field and global block config when adopting the helpers; no database change.
- Changed: `onInit` refuses registered blocks fields without the Experiment block or nested in a named group, array or tab. Migration impact: register a top-level blocks field through rows, collapsibles or unnamed tabs, and add the Experiment block before booting.
- Changed: Start refuses `placement-unpublished` for Experiment blocks and Puck slots found only on drafts; `empty-slot` checks published rows only. Migration impact: publish placement pages before starting existing Puck tests; no database change.
- Changed: saves on every registered `pages`, `blocks` and `puck` collection take a guard read and locks, and can refuse `page-busy` or `interacting-tests`. Migration impact: retry busy saves and finish interacting tests before publishing; no database change.
- Changed: deciding a stopped page test refuses `page-target-unpublished` for an unpublished Original or winner page; losing variants do not block the decision, and lookup errors propagate. Migration impact: publish routed pages before deciding; no database change.
- Added: frozen placement documents and guards against whole-page tests interacting with block or Puck tests, including bounded, retryable saves. The placement guard is installed on every `pages`, `blocks` and `puck` collection. Migration impact: nullable `xp_phases.placement_docs`; run `payload migrate:create` and `payload generate:importmap` (still required by the status field above).
- Changed: results health preserves page and goal checks together, including `placement-unchecked` rows with placement identifiers when content cannot be read. `Snapshot.health` and `SummaryResponse.health` are unions; TypeScript readers of `.path` must narrow the health row first. Migration impact: no database change; update affected TypeScript readers.
- Added: whole-page content checks and copying guidance per page collection, `admin.descriptions.page`, and page collection selection on tests. Identical versions warn; versions at the same address are refused. Migration impact: nullable `xp_experiments.page_collection` and `_xp_experiments_v.version_page_collection`; run `payload migrate:create`.
- Added: manager-only page browsing and page/test status endpoints, preserving published addresses while drafts are edited. Page registrations get a sidebar status field; page and blocks registrations get composed content-change auditing. Migration impact: hosts with `pages` run `payload generate:importmap`; auditing adds no columns.
- Added: `pageKindSeoContract` from `/rsc` to test host metadata and sitemap wiring. Migration impact: none.
- Added: permanent retirement of deleted test short names; new tests choose an unused suffix. Migration impact: nullable `xp_state.retired_slugs`; run `payload migrate:create`.
- Changed: legacy page tests resolve one collection from the Original (or the sole registration), then use it for every version. Migration impact: none; register `pageCollection` explicitly when several collections share an address.
- Changed: Puck consumers share the document-editor `appliesTo` rule, and `admin.editorUrl` receives `editor` and `doc`. Migration impact: none. (see 0.4.0-rc.2: corrected)

### BREAKING

- `onInit` refuses a registered blocks field that lacks the Experiment block or sits inside a named group, array or tab, and refuses host `metricSources` ids starting with the reserved `click:` prefix. Fix the registration, or rename the source, before booting.
- Saves on every registered `pages`, `blocks` and `puck` collection take a guard read and advisory locks, and can be refused `page-busy` (retry) or `interacting-tests` (finish the other test first).
- Start refuses `placement-unpublished` for Experiment blocks and Puck slots found only on drafts, so an existing Puck test whose slot is only on a draft can't start until its page is published.
- Deciding a stopped page test refuses an unpublished Original or winner page (`page-target-unpublished`).
- TypeScript: `Snapshot.health` and `SummaryResponse.health` are unions (narrow before reading `.path`); `ReadinessCode` and `RefusalCode` gain `goal-in-some-versions` and `placement-unchecked` (exhaustive switches add them); add-metric responses always carry `warnings`.
- Migration impact: four nullable plugin columns, no backfill: `xp_experiments.page_collection` and its version counterpart `_xp_experiments_v.version_page_collection`, `xp_phases.placement_docs` and `xp_state.retired_slugs`; run `payload migrate:create`. Hosts adopting `createExperimentBlock` also add, per blocks field, the Experiment block and slots tables, their `_v` version tables and the live/version `slot` enum types; hosts adopting `xpGoalField()` add one nullable text column per table using it, version tables included (`xpGoalPuckField()` adds none). Run `payload generate:importmap` for the new component keys `PlacementStatus`, `TestBlockField`, `BlockStatusField`, `BlockSlotRowLabel`, `CopyOriginalField` and `XpGoalField` (all `@delmaredigital/payload-experiments/admin/client`).

## [0.3.0-rc.4] - 2026-11-04

### plugin

- Changed: the accent contrast grid tests are restructured to finish within CI's time limit; no runtime change. Migration impact: none.

## [0.3.0-rc.3] - 2026-11-04

### plugin

- Fixed: the Tests group in the admin nav remembers being collapsed. A host nav group must not also be called "Tests" (it would share the group's state). The nav slot moves to `/admin/rsc#TestsNavLinkServer`; regenerate the import map (it adds `/admin/rsc#TestsNavLinkServer`; until then the Tests nav group does not appear). The old `/admin/client#TestsNavLink` export remains available.
- Fixed: with a custom `theme.accent`, buttons always show a visible hover and pressed state, including accents right at the contrast limit; in dark mode such accents darken on hover so the step stays visible.
- Added: `@delmaredigital/payload-experiments/admin/theme.css` and `/admin/ui.css` stylesheet exports, for hosts that run Puck outside Payload's admin; such a page also loads Payload's admin styles and sets `data-theme` (see the README). Inside the admin nothing changes.
- Fixed: the block's test picker in the Puck sidebar renders inside its own field root, styled by the plugin's admin styles.
- Added: the ExperimentsPageCollection type names one entry of the pages option. Migration impact: none.
- Changed: page lookups at start stop at the first collection that has the page published, and run per version in parallel. Migration impact: none.
- Fixed: the Tests home, goal and layer lists, the block's test picker and new-test names read every page, so sites with many tests no longer lose items past the first 100–200 or fail to create a test with a common name.
- Changed: CI workflows pin every action to a commit and give each job only the permissions it needs; only the publish job can request an npm OIDC token. Migration impact: none.

## [0.3.0-rc.2] - 2026-11-04

### plugin

- Fixed: starting a whole-page test and deleting, renaming or unpublishing one of its pages at the same moment can no longer leave the test running on a page that's gone: one waits for the other, and the later one is refused. A page whose test address was saved with a trailing slash is protected too. Migration impact: none.
- Added: the Experiment block in the Puck editor is a test builder: add up to three variants, rename, copy the Original into a version, remove a version, and set the traffic split, while the test is a draft or stopped; a running test shows people per version and the current leader.
- Fixed: publishing a page through the API or "Make it the content" no longer adds a false "content changed" marker to the results chart when only linked images or documents were expanded, including collections without drafts. Migration impact: none.
- Fixed: a whole-page test can't start while another running or decided test uses one of its pages, so visitors are never counted for a page they didn't see. Deciding a stopped whole-page test is refused the same way if another test has since started on its pages. A page an archived test still sends to its winner counts as in use until you release its pages or discard its result. Migration impact: none; hosts switching exhaustively on ReadinessCode add 'page-in-use'.
- Fixed: when someone else changed a test while you were editing it, the message is always the admin's own wording.
- Added: `experimentOutlinePlugin()` (from `/puck/editor`) hides a block's empty version slots that its test doesn't use from the Puck outline; a slot with content that isn't part of the test stays visible with a warning. Add it to your Puck plugins.
- Fixed: while a whole-page test is live, the Original's URL keeps a canonical to itself even when a visitor is served a version page there, so search engines never treat the Original as a copy of a noindexed version. Hosts merge `experimentMetadata` after their own metadata so its canonical wins. Migration impact: none.
- Fixed: after a whole-page test is archived, trying to delete, rename or unpublish the Original page now says its address shows the winner, instead of calling the Original the winner. Migration impact: none.
- Fixed: Preview opens its new tab in Safari and other browsers that block pop-ups opened after a delay; a refused preview shows plain-language copy instead of the server's message.
- Added: `admin.previewUrl` may be async and receives the placement's title, published state and slug; returning null hides preview for that placement, and the admin never shows "Preview isn't set up". The old `({ collection, id }) => string` form still works, and several slots on one page version share one lookup. Migration impact: none.
- Fixed: an event recorded in a visitor's own browser is always credited to that visitor when they saw the test, even if their link to a signed-in account can't be used. Migration impact: none.
- Changed: the Experiment block in the Puck editor uses the new layout: name and status, a tab per version, and clear actions.
- Added: `createExperimentSlotEditor` / `createExperimentSlot` take the host's admin and API routes (and accent); hosts on non-default routes switch to them.

## [0.3.0-rc.1] - 2026-11-03

### plugin

- Added: a manager can dismiss one failed entry in the "Make it the content" report (for a page deleted or copied by hand), so the test can be archived with its result. In the admin, each page that couldn't be updated has Dismiss (and Undo), Finish archiving appears once every page is updated or dismissed, and a test that archives itself says so. `POST /xp/experiments/:id/content-report/dismiss` dismisses an entry; `POST /xp/experiments/:id/content-report/restore` undoes a dismissal so the entry can be retried; `contentDone(report)` (exported from the package root) returns true when every entry is ok or dismissed (a present but empty report, as for page tests, is done; an absent report is not). Dismiss and restore refuse with `not-decided`, `entry-not-found`, `entry-ok`, `entry-dismissed` or `entry-not-dismissed` (new `RefusalCode` members; hosts switching exhaustively add them). Migration impact: none.
- Fixed: a registration from someone else's browser no longer receives credit for the account owner's later activity. The identity conflict share now counts only users whose credited events span arms, so it can read lower than in 0.2.x. Migration impact: see BREAKING.
- Changed: the Goals pages use the new layout; deleting a goal now asks for confirmation; choosing "Use this goal" from a test makes it that test's main goal.
- Fixed: a decided test's results show the numbers recorded at the decision everywhere on the page; results tables scroll sideways on narrow screens with a visible edge.
- Added: the results endpoint includes the test's name, kind and status (`experiment`), so people who can read results but not tests see the real title. Migration impact: none.
- Fixed: a block test can't be given a page-path targeting rule, or started with one; it runs wherever the block is placed. Migration impact: none; hosts switching exhaustively on ReadinessCode add 'block-path-rule'.
- Changed: the results page leads with the verdict and three key numbers, shows each outcome as a clear table ("Rate" or "Average"), and keeps the confidence chart under Details.
- Fixed: when something a test refers to was removed, the admin says what is missing (a goal or a round) instead of saying the test no longer exists.
- Fixed: a goal can't be deleted or have its short name or measurement changed while another save or Start is adding it to a test at the same moment. Migration impact: none.
- Fixed: Make it the content now works on collections with hidden or restricted fields: it publishes from the live page, so draft edits never leak into the published version. Localized collections are refused with a clear message and flagged before Decide (not supported yet). Migration impact: none.
- Added: `ContentReportReason` now includes `'localized'` (exported from `/` and `/rsc`), and `ReadinessCode` includes `'make-content-unsupported'`. Migration impact: none; hosts switching exhaustively on these unions add the new member.
- Changed: test page sections use the new controls: a versions grid with a traffic split bar, rule cards for who takes part, and plain-language advanced settings.
- Changed: the test page has a step list, numbered sections and a readiness bar with Start at the bottom.
- Fixed: the retention sweep logs its "made no progress" warning whenever the results budget ends before it deletes anything, including between statements. Migration impact: none.
- Changed: the Tests home shows tests as compact rows grouped by what needs doing, with a health label and one-line status for each; draft tests name the next step to finish setting them up.
- Fixed: a test's round records the sequential tuning value it started with (5,000 when left on Automatic), and a rollout round keeps the test round's value, so results never change if the default changes later. Migration impact: none.
- Added: the tests summary includes each draft or stopped test's next readiness step (`next: { code, detail? }`, ids only), so the home list can say what to do next. Migration impact: none.
- Added: `compileManifest` and its input/output types are exported from `/rsc`, so host tests can build a manifest without importing from `dist/` (a test helper: pass the same `attributeKeys` as the plugin options; its input shape may change in a pre-1.0 minor). Migration impact: none.
- Fixed: when the analysis of a test fails, the server log now names the reason (a fixed code and message) instead of only the error type. Migration impact: none.
- Fixed: a goal used by a test can't be deleted, and its short name and what it measures can't change, through any route (not only the Goals page). Migration impact: none.
- Changed: an unknown `pages.collections` slug now throws `Unknown experiments page collection` during plugin setup. Register host page collections before this plugin. Migration impact: no database migration; hosts with collections added by later plugins must reorder those plugins.
- Fixed: whole-page protection includes trash and version restores, with status-specific instructions; unchanged page health no longer creates repeated frozen snapshots, and page health reaches the Tests home. Decided tests check only the winner's and the Original's pages. Migration impact: none.
- Fixed: pages in a whole-page test can't be deleted, renamed or unpublished while the test runs or while its result stands; the editor is told which test to stop or discard. Migration impact: none.
- Added: a test whose version page stops resolving shows "Needs attention" after the next results run.
- Added: optional `theme.accent` plugin option with derived light/dark fills, accessible accent text and focus rings, and foreground contrast validation.
- Changed: admin design tokens and shared interface components for the 0.3.0 screens; Running and Ready use fixed green status colours, and the Puck editor stylesheet is generated from the same tokens.
- Fixed: the Original's page is never marked noindex during or after a whole-page test; version pages reached at their own URL are noindex with a canonical to the Original while running or decided. Archived paths keep their canonical to the winner. `experimentMetadata` now reads the signed request context via `headers()`: call it only from a dynamic `generateMetadata`, never inside `'use cache'`.
- Fixed: a whole-page test cannot start while a version page is unpublished (hosts that set the new `pages` option).
- Added: optional `pages` option (`pathOf`, `findByPath`) so the plugin can check version pages; see the README option table. Page protection hooks are not included. Migration impact: none.
- Fixed: readiness checks no longer show raw error text from the site's code.
- Fixed: results and make-content reports no longer store or show raw error text; they carry a reason code shown as plain copy, and the details go to the server log. Migration impact: none.
- Added: an archived whole-page test's results offer "Release pages", which lets every address show its own page again; the result stays recorded.
- Added: Release pages on archived whole-page tests removes their archived routing and page protection, and records who released them and when. Migration impact: four nullable columns: decision_pages_released_at and decision_pages_released_by on xp_experiments, and version_decision_pages_released_at and version_decision_pages_released_by on _xp_experiments_v; run payload migrate:create.

### BREAKING

- `linkIdentity` requires `verified: boolean` and returns `'linked' | 'verified' | 'skipped' | 'failed'`. Pass `true` only from a request that proves account ownership in this browser; registration and session refreshes do not prove ownership.
- Migration impact: one nullable column `verified_at` and one index on `user_id` in `xp_identities`; run `payload migrate:create` along with the release-pages columns above. Existing rows become unverified, which only narrows crediting. Optional backfill to keep old behaviour for old rows: `UPDATE xp_identities SET verified_at = linked_at WHERE verified_at IS NULL;`.

## [0.2.0-rc.7] - 2026-11-03

### plugin

- Fixed: the test page refuses to overwrite someone else's newer changes; it shows "Someone else changed this test. Reload to see their changes." with a Reload button.
- Added: edits to a test made from two places at once no longer overwrite each other: a save based on an outdated copy is refused with "Someone else changed this test. Reload to see their changes." (clients opt in with the `x-xp-if-updated-at` header; its name is exported as `XP_IF_UPDATED_AT_HEADER` from `@delmaredigital/payload-experiments/admin/client`).
- Fixed: while a test is collecting data, results say which group is smallest and which has the fewest conversions, and how many each still needs, instead of counts that read as totals.
- Fixed: after Recompute, the results page's status line shows the updated number of people.
- Fixed: plugin logs no longer include error messages or database details; they carry the error name, code and stack frames. Migration impact: none.

## [0.2.0-rc.6] - 2026-11-03

### plugin

- Fixed: the Puck outline names an Experiment block's versions (Original, Variant A, Variant B, Variant C) and lists the Original first.
- Fixed: "Set up the test" and "View results" in the Puck editor open in a new tab, so the editor keeps unsaved changes and hosts that deny framing no longer break the canvas.
- Fixed: newly started tests can show collecting results before anyone has seen a version; analysis failures report “Results could not be computed; this has been logged.” instead of “Try again”. Migration impact: none.
- Added: the public `/rsc` `runResults` summary includes a `failed` count for non-budget errors, including scheduling and retention-sweep failures.

## [0.2.0-rc.5] - 2026-11-03

### plugin

- Changed: the sidebar shows a Tests group (All tests, Goals) to users who can manage tests; the dashboard shows All tests and Goals cards to users who can manage tests. Hosts must run `payload generate:importmap` after upgrading to register the new dashboard component.
- Every plugin collection and global now states `versions` explicitly (`false`, except Tests, which keep their version history). No schema change on Payload 3; prevents default versioning tables on Payload 4.
- Fixed: preview links list each page once, even when it has a published version and a newer draft; a page holding the test more than once shows how many times.

Migration impact: none.

## [0.2.0-rc.4] - 2026-11-03

### plugin

- Added Goals list and form pages inside Tests, reached through the "Manage goals" link. Migration impact: none.
- Centralized admin theme tokens and moved Tests above collection groups, after any host-provided leading navigation links.
- Audience list rules without fixed values now use keyboard-accessible chips and save arrays; fixed value lists keep their checkboxes, and existing comma-separated values remain readable.
- Styled the Puck Experiment block header, warning, version tabs, selected-version copy action, empty drop zones and creation panel for host editor resets and both admin themes. The self-contained stylesheet is exported as `@delmaredigital/payload-experiments/puck/editor.css`. Hosts must load it inside the editor iframe: in the CSS that builds the iframe stylesheet, add `@import "@delmaredigital/payload-experiments/puck/editor.css";` after `@import "tailwindcss";`. Alternatively, serve the exported file and append its URL to payload-puck's `editorStylesheets`, after the host stylesheet. The client import alone does not reach an iframe with `syncHostStyles: false`. A block already linked to a test no longer offers "Test this block"; it links to "Set up the test" while the test is a draft and to "View results" afterwards.
- Release workflow: prereleases now publish under their own npm dist-tag (`rc` for this line), not `next`, and a tag whose version, or whose CHANGELOG notes, do not match the package is refused before publishing. Install release candidates with `@rc` or an exact version.

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
