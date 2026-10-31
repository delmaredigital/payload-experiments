# @delmaredigital/payload-experiments

A/B testing for Payload CMS and Next.js, with results inside the admin and data
in your own Postgres database. Editors can test blocks, whole pages and
registered flag points, choose a winner, and make it the permanent content.
Results count people who actually saw the content, with checks for traffic
imbalances and metrics that must not get worse. Puck support is optional.

```sh
pnpm add @delmaredigital/payload-experiments
```

## Setup

Requires Node.js `>=22.23.4`, Next.js App Router, and Postgres through
`@payloadcms/db-postgres` with transactions enabled. Other database adapters
are not supported. Install the peers used by your host:

| Peer | Range |
| --- | --- |
| `payload`, `@payloadcms/db-postgres`, `@payloadcms/next`, `@payloadcms/ui` | `>=3.90.0 <4` |
| `next` | `>=16.4.1 <17` |
| `react`, `react-dom` | `>=19.2.1 <20` |
| `pg` | `>=8.13.0 <9` |
| `@puckeditor/core` (optional, for Puck integration) | `>=0.24.0` |

Create one proxy runtime, then a server runtime shared by your Payload config
and server readers. Keep Payload imports lazy so the proxy stays independent
of Payload, React and Puck:

```ts
// experiments/proxyRuntime.ts
import {
  defineExperimentsProxyRuntime,
  createPostgresManifestLoader,
} from '@delmaredigital/payload-experiments/runtime/proxy'
import { manifestPool } from '@/db/manifestPool' // host-owned pg Pool

export const proxyRuntime = defineExperimentsProxyRuntime({
  secret: process.env.XP_SECRET!,
  apiRoute: '/api', // match Payload's config.routes.api
  loadManifest: createPostgresManifestLoader({ pool: manifestPool }),
})

// experiments/serverRuntime.ts
import { defineExperimentsServerRuntime } from
  '@delmaredigital/payload-experiments/runtime/server'
import { proxyRuntime } from './proxyRuntime'

export const serverRuntime = defineExperimentsServerRuntime(proxyRuntime, {
  getPayload: async () => {
    const { getPayload } = await import('payload')
    const { default: config } = await import('@payload-config')
    return getPayload({ config })
  },
})

// In payload.config.ts
import { createExperimentsPlugin } from '@delmaredigital/payload-experiments'
import { serverRuntime } from '@/experiments/serverRuntime'
import { canManageExperiments } from '@/access/experiments' // host permission check

// Add to buildConfig({ plugins: [...] })
createExperimentsPlugin({
  runtime: serverRuntime,
  access: { manage: canManageExperiments },
  puck: {
    enabled: true,
    collections: ['pages', { slug: 'templates', field: 'content' }],
  },
})
```

`secret` is required on `defineExperimentsProxyRuntime`, not a top-level plugin
option. Use a stable, private secret shared by all instances. For rotation, pass
an array with the newest secret first; older entries verify existing signatures.
Set a finite `connectionTimeoutMillis` on the host's manifest pool to bound
connection acquisition. `createPostgresManifestLoader` also accepts `schemaName`
when Payload uses a custom Postgres schema. It reads the private compiled
manifest directly, avoiding HTTP calls back into your deployment.

`createExperimentsPlugin` requires `runtime` and `access.manage`. The permission
callback receives `{ req }` and must return a boolean (or a promise of one);
permission is granted only for `true`. Optional `access.admin` and
`access.readResults` default to `manage`; `access.readIdentities` defaults to
`admin`. Use `admin` for code experiments and changing the analysis method.
Other plugin options are `flagPoints`, `metricSources`, `eventSources`,
`attributeKeys`, `puck` and `events`:

- `attributeKeys` declares targeting attributes as `{ type, values? }`, with
  `type` one of `string`, `number`, `boolean`; optional string `values` supplies
  an admin select. Pass only non-identifying attributes.
- `puck.collections` registers existing host collections for placement discovery,
  content-change markers and making winners permanent. A slug string uses the
  `puckData` JSON field; `{ slug, field }` names another field. `puck.enabled`
  defaults to `true` when this list is non-empty; set it explicitly in TypeScript
  config (the current public type requires it). `false` disables the installed
  content-change hook.
- `events.retentionDays` defaults to `180`; `events.maxBodyBytes` to `8192`.
  Both must be positive integers. `events.rateLimit` is an optional host adapter,
  called with `{ req, unitId }`; return `true` to permit or `false` to drop.
  Supply a shared limiter suitable for your deployment; there is no built-in
  in-memory limiter.

The plugin adds `xp-experiments`, `xp-phases`, `xp-layers`, `xp-metrics`,
`xp-events`, `xp-identities`, `xp-results-snapshots` and the `xp-state` global.
The host owns their migrations. After registering the plugin, generate and
review a migration, then apply it in the host:

```sh
pnpm exec payload migrate:create
pnpm exec payload migrate
```

## Next.js proxy

For a standalone proxy, export the wrapper from your host's `proxy.ts`:

```ts
import { createExperimentProxy } from '@delmaredigital/payload-experiments/proxy'
import { proxyRuntime } from '@/experiments/proxyRuntime'

export const proxy = createExperimentProxy(proxyRuntime)
```

To compose with other proxy logic, call `resolveExperiments` and forward its
request headers on **both** the normal response and any page rewrite. Then call
`applyExperiments` to attach response cookies and headers:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { resolveExperiments, applyExperiments } from
  '@delmaredigital/payload-experiments/proxy'
import { proxyRuntime } from '@/experiments/proxyRuntime'

export async function proxy(request: NextRequest) {
  const result = await resolveExperiments(request, proxyRuntime)
  const options = { request: { headers: result.requestHeaders } }
  const response = result.rewrite
    ? NextResponse.rewrite(result.rewrite, options)
    : NextResponse.next(options)
  return applyExperiments(response, result)
}
```

The default `xp_id` cookie is a signed opaque visitor id: HttpOnly,
SameSite=Lax, Secure on HTTPS, path `/`, lifetime 365 days. Runtime `cookie`
options are `name`, `maxAgeDays`, `domain` and `consent`. A newly minted cookie
is forwarded into the same request, so server readers see it immediately.
Inbound `x-xp-*` headers are removed before any skip check. The proxy writes
signed `x-xp-assignments` (at most 1 KB) and `x-xp-request` (method, path/search
and consent, at most 2048 bytes). Server readers verify these; unsigned or
changed values are ignored, with a safe fallback when context is missing.

`cookie.consent(request)` must read **cookies and headers only**: server
conversion and identity helpers call it with a placeholder URL. When it returns
`false`, nobody is enrolled, including signed-in users; no visitor id is minted
or honoured, and an existing unit cookie is removed from the forwarded request.
Running tests show the Original. Decided winners without an active holdout
round still serve the decided content subject to targeting. Archived page
rewrites serve shipped content by path alone. Neither records exposure.
`linkIdentity` and `trackConversion`
also become no-ops when consent is declined. Omitting `consent` permits cookies
and enrolment.

Optional runtime `getUnit(request)` returns `{ userId?, attributes,
sessionUnknown? }`, synchronously or asynchronously. Use opaque user ids. With
no session token, return known logged-out attributes such as
`{ loggedIn: false, staff: false }`. With a verified session cache, return the
known user and attributes; with an unresolved session, set `sessionUnknown:
true`. User-unit experiments and session-dependent targeting can then be
resolved on the server through `getUser`. Server runtime options `userIdOf`
(default `String(user.id)`) and `attributesOf` map the host user to the unit id
and targeting attributes; server attributes take precedence. `attributesOf`
defaults to `{ loggedIn: Boolean(user) }`; declaring `staff` in `attributeKeys`
requires an explicit `attributesOf` that identifies staff. The plugin owns the
normalized `path` attribute (no search, no trailing slash except `/`).

Staff, bots detected by the built-in user-agent list, preview renders and `HEAD`
requests produce no exposures. A signed `xp_preview` token can select a group
for review without counting it; preview responses are not cached. The plugin
skips admin, API, Next internals and asset paths. Host editor renders must also
remain outside exposure recording.

Whole-page experiments use visitor units only. Requests to any target path are
rewritten to the assigned group's page; a holdout sees the Original page. After
a winner is made permanent, losing paths keep rewriting to the winner while
the archived experiment record exists. A live experiment targeting a path takes
precedence. Decided winners remain subject to targeting.

## Server components (`/rsc`)

Import server helpers from `@delmaredigital/payload-experiments/rsc`.
`getAssignments(serverRuntime, { user? })` reads and verifies request context,
resolves deferred users, and recomputes stale or missing assignments using the
signed cookie and manifest. It is memoised per request. It reads dynamic Next
headers: call it inside `<Suspense>` under Cache Components, outside
`'use cache'`.

For Puck content, resolve before rendering and record only the returned
`rendered` list after the response. Capture all request values before `after()`:

```tsx
import { after } from 'next/server'
import { getAssignments, resolveExperimentData, recordExposures } from
  '@delmaredigital/payload-experiments/rsc'
import { serverRuntime } from '@/experiments/serverRuntime'

// Inside your async Server Component, after loading the host page:
const assignments = await getAssignments(serverRuntime)
const { data, rendered } = resolveExperimentData(page.puckData, assignments)
after(() => recordExposures(serverRuntime, rendered, assignments))
// Render `data` with your host's Puck render config.
```

**Exposure is the denominator.** Reading an assignment is not an exposure.
`resolveExperimentData` removes unselected content and returns only block
experiments actually present with the `render` policy. Pass that list to
`recordExposures(serverRuntime, rendered, assignments)`, never the full
assignment map. Only schedule it when you render that resolved content.
Viewport and pageview exposures come from the client; manual flag/code
exposures require an explicit host call. Non-enrolled units see the Original
without being counted. Same-unit exposures to multiple groups in a round are
excluded and reported.

Next's default prefetch does not render the dynamic subtree in `<Suspense>`.
Full prefetch (`<Link prefetch={true}>` or full `router.prefetch`) of pages with
`render`-policy slots is unsupported: it would record content before a visit.

`toClientAssignments(assignments, { pathname, apiRoute?, flagPoints?,
experiments? })` creates the provider value without visitor identifiers. Both
allow-lists default to empty. Use the served page's pathname for pageview
logging; see the client integration below.

`getFlagPoint(serverRuntime, id, { user? })` returns `arm`, `params`, `source`
(`experiment` or `default`), optional `experiment`/`experimentId`, and
`expose(renderedArm)`. Bind host code to the registered point id. It uses the
live experiment, then saved winner defaults, then the point's `defaultParams`.
Render the returned settings and call `await point.expose(point.arm)` only
when that arm's content is actually delivered; this records only the manual
exposure policy. Nothing is exposed by reading the point.

Other server integrations:

- `trackConversion(serverRuntime, { eventName, value?, idempotencyKey, userId?,
  headers? })` records a server event (default value `1`). Use a stable, globally
  unique idempotency key for each business event. Pass request headers when
  outside a Next request; a user-only server conversion can supply `userId`.
  Record revenue through trusted server code or a metric source, never a client
  beacon.
- `linkIdentity(serverRuntime, { headers, userId })` belongs on **every**
  user-creation and sign-in path. It links the signed anonymous cookie to the
  opaque user id using insert-ignore on its own connection and never throws into
  sign-in. For visitor experiments using user-keyed outcomes, credit goes to the
  earliest-exposed linked visitor; cross-group links are reported separately.
- `eraseUser(payload, { userId })` deletes the user's identities and associated
  events transactionally and returns `{ identities, events }` counts. Call it
  from the host's authorized user-erasure flow.
- `recordContentChange({ doc, previousDoc, req, collection })` can be called
  from a host collection's `afterChange` for content tagged with the arm-select
  field. Supply that hook's transaction request. Puck collections get the hook
  automatically when enabled. Markers compare published content; drafts and
  autosaves do not add markers (collections without drafts record on save).
  The explicit helper propagates failures; the installed Puck hook catches and
  logs them so content saves can proceed.
- `experimentMetadata(serverRuntime, path)` returns metadata to merge into the
  page's Next metadata: live variant targets get noindex and an Original
  canonical; archived losing paths point canonically to the winner.
  `experimentSitemapFilter(path, manifest)` is a synchronous build-time filter:
  pass a privately server-loaded manifest and keep paths for which it returns
  `true`, excluding live variants and archived losing paths.

## Results

The host owns scheduling and authentication. Call
`runResults(payload, { budgetMs })` in-process from your cron route; no Payload
jobs queue or HTTP call back into the application is needed:

```ts
// app/api/cron/xp-results/route.ts
import { runResults } from '@delmaredigital/payload-experiments/rsc'
import { serverRuntime } from '@/experiments/serverRuntime'
import { isAuthorizedCronRequest } from '@/auth/cron' // host-owned auth

export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return new Response('Unauthorized', { status: 401 })
  }
  const payload = await serverRuntime.getPayload()
  const result = await runResults(payload, { budgetMs: 20_000 })
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
```

The default budget is 20 seconds. Choose a budget below the host route's timeout.
The runner prioritizes the oldest snapshots, checks the remaining budget before
metrics, bounds waiting for host `query`/`covariate` promises and database
connections, and applies a remaining-budget SQL statement timeout. Hung work
cannot keep the runner waiting beyond that budget. Source failures mark that
metric unavailable. A timed-out source is reported in `unavailableMetrics`;
that experiment's new snapshots are not written, its previous snapshots remain,
and `budgetExhausted` signals the cutoff. Racing a host promise does not cancel
its underlying work: give your own source clients appropriate timeouts too.
The returned summary also includes `ran`, `skipped`, `swept` and `processedIds`.
Optional `experimentId` limits analysis to one experiment; `sweep: false`
disables retention for that call.

Analysis uses each round's frozen config and actual exposures. Its window ends
at `endedAt`; later exposures and conversions are excluded. Finished rounds
have a **24-hour late-beacon grace** before their final snapshot freezes: once
a snapshot has been computed after that grace, later runs leave it unchanged.
This does not extend the attribution window beyond the round's end.

Event retention defaults to **180 days after the experiment's final round
ends**, configurable with `events.retentionDays`. No experiment events are
swept while any of its rounds is open, including a long-lived holdout round.
The runner reserves part of its budget for the batched retention sweep.

Routes below are relative to Payload's `config.routes.api` (normally `/api`):

| Endpoint | Permission and response |
| --- | --- |
| `GET /xp/experiments/:id/results?phase=1&series=1` | `access.readResults`; round summaries, newest selected-round `snapshot` (`null` before a run), optional `decisionSnapshot` and requested time series. Without `phase`, a decided experiment opens on its decision round. |
| `GET /xp/experiments/summary?ids=...` | `access.readResults`; map of experiment ids to exposures, days and verdict summary. Encode each id individually, comma-join, and request at most 100 ids. |
| `POST /xp/experiments/:id/recompute` | `access.manage`; runs results for one experiment without sweeping and returns `{ snapshotId }`. Failed or budget-exhausted work returns an error. Frozen rounds stay frozen. |

## Flag points and metric sources

Register stable host integration points in `flagPoints`. `defineFlagPoint` and
`defineMetricSource` are optional typed identity helpers from the root export;
the root also exports the `FlagPoint`, `ParamField` and `MetricSource` types.

A `FlagPoint` has `id`, `label`, `params` and `defaultParams`. `params` maps
setting names to `ParamField` definitions: `{ type, label, required?, options?,
min?, max? }`. Supported types are `text`, `textarea`, `number`, `checkbox`,
`select`; select options are `{ label, value }`. Keep defaults valid for that
schema. Optional callbacks integrate host-owned content:

- `placements({ experimentId, arms, req })` returns
  `[{ arm, ok, detail? }]` for the required content groups at Start. Holdouts
  use Original content and are not passed as required placements.
- `makeContent({ experimentId, winner: { arm, params }, req })` runs when the
  chosen settings are made permanent. Match host tags on both experiment id
  and arm. Use the manager's `req` and `overrideAccess: false` for host-document
  writes. The plugin saves the winning settings as defaults for the point.

A `MetricSource`, registered in `metricSources`, has `id`, `label`,
`kind: 'binomial' | 'count' | 'revenue'`, and `keyedBy: 'visitor' | 'user'`.
`clientWritable` optionally permits client conversions (revenue is always
server-only). `query({ from, to, unitIds? })` returns a promise of
`[{ unitId, value, ts }]`, **one row per event**, with `ts` a `Date`; use the
same opaque ids as assignment or identity linking. A user experiment requires
a user-keyed source. Visitor experiments can use a user-keyed source through
linked identities.

Optional `covariate({ units: [{ unitId, firstExposureTs }], lookbackDays })`
returns `[{ unitId, value }]` for pre-exposure CUPED adjustment. Percentile
revenue capping reuses `query` over the 90 days before Start; the resolved cap
is frozen for the round. Capping affects decision statistics, while results
also show uncapped totals. Count and binomial metrics are never capped.

For simple yes/no outcomes, list names in `eventSources`, for example
`eventSources: ['signup']`. Names must match `/^[a-z0-9_]+$/`. Editors can then
choose `events:signup` as a binomial source, backed by stored conversions with
`eventName: 'signup'`, from either `trackConversion` or
`trackConversionBeacon`. Only listed event names become `events:<name>`
sources. They support visitor and user units and allow client writes; they do
not represent counts or revenue in v1.

## Security

The unit cookie, assignments header, request-context header and preview tokens
are HMAC-SHA256 signed with purpose-separated inputs and constant-time
verification. Signing prevents a browser from choosing a trusted identity,
assigned arm, request context or preview group by editing a value. The manifest
is private. Store no PII beyond opaque unit ids: keep names, emails and other
identifying values out of attributes, params and event data.

Every collection/global access operation is explicit: create, read, update,
delete, readVersions and unlock. Managers operate experiments, layers and
metrics; results and identity reads have separate permissions. Internal event,
identity, round, snapshot and state writes are denied through ordinary
collection/global access. Every Payload Local API call declares
`overrideAccess`; request handlers and views pass `req` and
`overrideAccess: false`. The enumerated privileged operations are the events
insert and assignment lookup, `recordExposures`, server `trackConversion`,
`linkIdentity`, manifest reads, transition writes to plugin collections/state,
content-change markers, results writes and retention sweep, and `eraseUser`.
Host content writes when making a winner permanent still use the manager's
access. Privileged side effects follow their authorized operation in the same
transaction; identity linking deliberately uses its own insert-ignore connection
so duplicate links cannot abort sign-in.

`POST /xp/events` requires a valid signed unit cookie, reads a streamed body
with an **8192-byte default limit**, and accepts at most **20 events** per body.
It parses JSON regardless of content type for beacon compatibility. Exposure
beacons must name the current round, policy and the arm actually rendered;
the server recomputes assignment and drops mismatches while counting them
separately. Only manual, viewport and pageview exposure policies are accepted.
Conversions require a client-writable source, never revenue; client values are
stored as `1`, attributes are allow-listed, and the host's `events.rateLimit`
adapter runs when supplied. Accepted and dropped events both return `202 {}`;
malformed requests can return errors.

**The real bound on slow or method-override bodies is the host firewall/platform
timeout.** A stream under the byte limit can remain open, and Payload can read
an `X-HTTP-Method-Override` body before the plugin's streamed cap runs. Apply
host firewall rules and platform request timeouts at that boundary.

Static checks enforce explicit access and keep raw SQL in the database modules,
but have accepted gaps: extracting a Payload method with a computed property
in destructuring; reflection through `Object.getOwnPropertyNames`,
`Object.getOwnPropertyDescriptor` or `Reflect.ownKeys`; capturing a computed
method from an unknown receiver and calling it later; `payload.jobs.*` calls
(the jobs queue is not used or supported here); lowercase SQL through `pg`;
and aliases changed through `let` reassignment. **Code review is the backstop**
for these patterns.

## Admin and client

### Client assignments and exposure

Read assignments on the server and pass them to `ExperimentsProvider` from
`@delmaredigital/payload-experiments/client`. Build its `value` with
`toClientAssignments` from `@delmaredigital/payload-experiments/rsc`:

```tsx
<ExperimentsProvider value={toClientAssignments(assignments, {
  pathname,
  flagPoints: ['signup-form'],
  experiments: ['welcome-copy'],
})}>
  {children}
</ExperimentsProvider>
```

`flagPoints` and `experiments` are allow-lists: both default to none. Include
only the flag points and experiments that the client needs. The provider value
contains no visitor identifier. Use **one `apiRoute` for every provider on a
page**, including nested providers; it is the API base, such as `/api`. When the
API isn't at `/api`, set that shared route through
`toClientAssignments(assignments, { pathname, apiRoute })`.

`useFlagPoint(id)` reads the current group and settings at a registered flag
point. `useExperiment(slug)` reads an allow-listed experiment. An unlisted flag
point or experiment slug throws in development and returns the Original with
one console error in production. Neither hook records exposure automatically.
For manual exposure, call
`expose(renderedArm)` only when that group's content actually showed, passing
the group key you rendered. Reading an assignment alone does not count as
seeing content. `expose()` sends only for experiments using the manual exposure
policy.

On each whole-page experiment target, render a nested `ExperimentsProvider`
whose value is built for **that page's pathname**, and put
`<ExperimentPageview />` inside it. This component reads from the nearest
provider and records the page that appeared, including after navigation.

Every page that renders Puck viewport slots also needs a provider. A
layout-level provider with empty allow-lists is enough:
`toClientAssignments(assignments, { pathname })`. Without a provider, viewport
exposures cannot be sent.

For a client-writable conversion, call
`trackConversionBeacon(eventName, { idempotencyKey })`. Pass a stable key for
conversions that matter, so retries count as the same conversion. It sends
nothing without a mounted provider. The server accepts only conversion sources
configured to allow client writes; record revenue on the server.

### Puck render and editor configs

Register `ExperimentSlot` from `@delmaredigital/payload-experiments/puck` in
your render config and `ExperimentSlotEditor` from
`@delmaredigital/payload-experiments/puck/editor` in your editor config, using
the same `ExperimentSlot` component name:

```ts
// Render config
components: { ExperimentSlot }

// Editor config
components: { ExperimentSlot: ExperimentSlotEditor }
```

Resolve the Puck data on the server with `resolveExperimentData` before
rendering it. The render component shows only the selected group's slot. The
editor lets you select a block experiment, edit each group's content, copy the
Original into a variant, or create an experiment. It warns when edits would
change content during a running test. `createExperimentSlotField` is available
from `/puck` if you need the experiment picker in another custom component.

The picker lists the 100 most recently updated block experiments.
Viewport exposure watches a fixed, invisible **100 px sentinel**
at the top of the slot and counts it when at least half is visible. The
sentinel stays the same size for short and tall content.

### Tag host content with a group

Add `createArmSelectField({ flagPoint: 'signup-form' })` from
`@delmaredigital/payload-experiments` to a host collection's fields. By default
the field is named `experimentArm`; it stores
`{ experiment: String(experimentId), arm }`.

Match host content on **`String(experimentId)` plus the arm key**, never on
the experiment slug. The field shows group labels, leaves out the holdout,
warns about tags from an earlier experiment, and lets you clear them. A running
experiment shows a warning before you change its content.

### Inside the admin

The experiment's edit tabs guide setup:

- **What:** what you are testing and why, including the flag point when needed.
- **Who:** who takes part, targeting, allocation, and space in a layer.
- **Groups:** the Original, variants and optional holdout, their percentages,
  settings, or page paths.
- **Metrics:** the main outcome, supporting metrics, guardrails, and planned
  duration.
- **Review:** saved setup checks, placements and preview links, recent traffic,
  and a duration estimate when enough information is available. Apply copies
  the suggested duration and sensitivity into the form; save before you start.

The **Results** view lets you select a round, read the verdict, compare groups,
check data quality, and see results over time with content-change markers.
Holdouts are measured without being compared during the test. Revenue results
show uncapped totals alongside any capped decision statistic. Recompute
requests fresh results. The experiment list shows status and a results summary;
round history and layer usage provide context in the admin.

Actions depend on the experiment's status and your permissions. **Unsaved
changes block actions**; save first so they use the saved experiment.

- **Start** runs a draft. **Start a new round** after stopping warns:
  “Starting again begins a new round; results restart.”
- **Stop** says: “Everyone will see the Original. Starting again begins a new
  round; results restart.”
- **Raise allocation** adds people without changing the group of anyone
  already taking part. Lowering allocation needs a new round.
- **Add a metric** adds a supporting metric or guardrail to a running test.
- **Decide** starts with the recommended group. Choosing the Original says
  “Everyone will see the Original.” Choosing a variant says everyone will see
  it, except an existing holdout, which keeps seeing the Original so you can
  measure the shipped change. When results need caution or you choose against
  the recommendation, enter a note and type the chosen group's label.
- **Release holdout** says the holdout will see the winner too and measuring
  since shipping ends.
- **Make it the content** copies the winner into page content or saves its
  settings as defaults, then archives the experiment. Failed page updates are
  listed with Retry. **Finish archiving** completes archiving when the content
  has already been updated.
- **Archive** closes a stopped experiment. **Discard winner** says: “Everyone
  goes back to the Original. The decision note is kept.” It requires typed
  confirmation. For code experiments, the action confirming that the developer
  has hard-coded the winner also requires typed confirmation before archiving.

### Known limitations (v1)

- Preview links open after a token request, so Safari's popup blocker may block
  them. Allow popups for the admin.
- “Raise allocation” is offered even at 100%.
- The metric picker in “Add a metric” lists 100 metrics.
- The Puck picker lists 100 experiments.
- The Puck experiment picker always calls `/api`; hosts with a custom API route
  see an empty picker.
- Making a winner permanent skips pages in collections that are localized,
  have hidden fields, or contain fields the manager cannot read. Those pages
  are listed with a note to update them by hand.
- Content-change markers are recorded on publish only (on save for collections
  without drafts). A first publish can miss a marker when the page was created
  as a draft already containing a running experiment's slot and published without
  further edits; this affects the chart annotation, not the results.
- Results cover the whole round; breakdowns by segment or dimension are not
  available in v1.
