# @delmaredigital/payload-experiments

> ⚠️ Upgrading to 0.3? For 0.3.0-rc.1, every `linkIdentity` call must supply `verified`; it now returns an outcome. Run `payload migrate:create` for the nullable `xp_identities.verified_at` column and `user_id` index, plus the release-pages columns listed in the CHANGELOG (`decision_pages_released_at` / `decision_pages_released_by` on `xp_experiments` and their `version_` counterparts on `_xp_experiments_v`). Existing identity links become unverified; see the CHANGELOG for optional backfill.

> ⚠️ Upgrading to 0.2? After upgrading, run `payload generate:importmap`: the Tests surface is registered through admin.dependencies, and without it the Tests routes show a 'not installed' message instead of the Tests screen. In 0.2.0-rc.2, the Tests server views moved from `/rsc` to `/admin/rsc`, so the import map must be regenerated when upgrading from rc.1 too. The old experiments edit-form components are gone from `/admin/client`, and the `xp-experiments` admin list and edit views now redirect to the Tests surface.

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
`attributeKeys`, `pages`, `puck` and `events`:

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
- `events.dimensions` (optional, default none) names up to 8 request attributes
  to record on each exposure for later analysis, for example `['loggedIn']`.
  Values come only from the attributes the server computes for that request
  (`path`, `loggedIn`, `staff` and your `getUnit` attributes), never from what a
  browser sends; only strings (first 64 characters), numbers and booleans are
  kept. Names that identify a person (such as `userId`, `email` or `ip`) are
  refused at startup, but whether an attribute you add yourself identifies
  someone is your responsibility. For client-reported exposures `path` is the
  page path from the request's `Referer`. Reporting by dimension is not yet
  available.
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
defaults to `{ loggedIn: Boolean(user) }`. If you declare `staff` in
`attributeKeys`, pass your own `attributesOf` that identifies staff to
`defineExperimentsServerRuntime`; the plugin refuses to start otherwise. The plugin owns the
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
- `linkIdentity(serverRuntime, { headers, userId, verified })` belongs on every
  user-creation and proving sign-in path; see Identity linking below.
- `eraseUser(payload, { userId })` deletes the user's identities and associated
  events transactionally and returns `{ identities, events }` counts. Call it
  from the host's authorized user-erasure flow.
- `recordContentChange({ doc, previousDoc, req, collection })` can be called
  from a host collection's `afterChange` for content tagged with the arm-select
  field; for a collection with drafts, also add `captureContentBaseline` to its
  `beforeChange` hooks so the previously published content can be compared.
  Collections without drafts can also add `captureContentBaseline` for an exact
  raw comparison; without it, the helper normalises relationships to ids. No host
  change is required for collections without drafts. Supply that hook's transaction request. Puck collections get the hook
  automatically when enabled. Markers compare published content; drafts and
  autosaves do not add markers (collections without drafts record on save).
  Neither the helper nor the installed hooks ever throw into your save: a
  failure is logged and the content save proceeds.
- `experimentMetadata(serverRuntime, path)` returns metadata to merge into the
  page's Next metadata: live variant targets get noindex and an Original
  canonical; archived losing paths point canonically to the winner. It reads
  the signed request context via `headers()`, so it decides from the URL the
  visitor requested, not the rewritten route, and the Original's URL is never
  noindex. While a test is live the Original's URL also gets a canonical to
  itself, even when it is served with a variant's route: merge this result after
  your own metadata so its `alternates.canonical` wins over one derived from the
  rendered route. Call it only from a dynamic `generateMetadata`, never inside
  `'use cache'`; `path` is the fallback when the proxy did not run.
  `experimentSitemapFilter(path, manifest)` is a synchronous build-time filter:
  pass a privately server-loaded manifest and keep paths for which it returns
  `true`, excluding live variants and archived losing paths.

## Identity linking

Call `linkIdentity(serverRuntime, { headers, userId, verified })` on every
user-creation and proving sign-in path. It links the signed anonymous cookie
to an opaque user id on its own connection and never throws into sign-in.
`verified` is required. Pass `true` only when **this request proves, in this
browser, that the person owns the account**: a magic-link or one-time-code
callback, password sign-in, or OAuth callback. It does not mean "a session
exists" or "the account's email is verified". Registration alone uses `false`.

```ts
// Registration, before proof of account ownership:
await linkIdentity(serverRuntime, { headers, userId, verified: false })
// After successful magic-link/code verification in this browser:
await linkIdentity(serverRuntime, { headers, userId, verified: true })
// After a successful password sign-in (or OAuth callback):
await linkIdentity(serverRuntime, { headers, userId, verified: true })
```

An auth "after" hook that fires whenever a new session cookie is set also
fires on routine session refreshes; pass `verified: true` only from proving
sign-in paths, never from a refresh.

The result is `'linked'` for an inserted link, `'verified'` for an upgraded
unverified link, `'skipped'` for no consent, no valid unit cookie or an existing
link with nothing to change, and `'failed'` for an error (safely logged).
First link per browser wins; a different account never replaces it.

For visitor experiments with user-keyed events, verified links are always
eligible. Unverified links are eligible only before the first verification
across all of that user's browsers, or indefinitely if nobody ever verifies.
Each event goes to the earliest exposed eligible visitor. Eligible links
spanning groups are reported as a diagnostic. User-keyed CUPED covariates use
the same eligibility rule at each visitor's first exposure and credit one
aggregate value to the earliest eligible visitor per user.

Accepted limits:

- Cross-device: register in A, verify on B, keep using A. A's events after B's
  proof are not credited until a proving sign-in on A upgrades A. Events before
  B's proof, including the registration funnel, remain credited. Once A is
  upgraded, its link is verified and eligible for all its events, so the next
  results run also credits A's events from between B's proof and the upgrade.
- Password set before verification: a later password sign-in is proof the
  plugin accepts. Whether unverified registration may set a password is a host
  authentication concern.
- Shared device: a different user's verified sign-in never relinks an already
  linked browser and returns `'skipped'`; that user's events get no credit
  through that browser.
- If someone registers another person's email from their own browser and that
  person never signs in, a later user-keyed event the host records against that
  account (for example an offline gift) is credited to the registering browser.
  It needs a deliberate registration of someone else's email plus an event
  matched to that account, and it moves one unit's value, never assignment.
  There is no time window, so recurring gifts from never-signed-in donors keep
  counting.

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
The returned summary also includes `ran`, `skipped`, `swept`, `sweepAttempted` and `processedIds`.
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
returns `[{ unitId, value }]`, one aggregate value per unit for pre-exposure
CUPED adjustment (the plugin asks for a 14-day lookback). Percentile
revenue capping reuses `query` over the 90 days before Start; the resolved cap
is frozen for the round. Capping affects decision statistics, while results
also show uncapped totals. Count and binomial metrics are never capped.

For simple yes/no outcomes, list names in `eventSources`, for example
`eventSources: ['signup']`. A bare string allows client writes; the object form
sets that permission explicitly:

```ts
eventSources: ['signup', { name: 'donation_completed', clientWritable: false }]
```

Names must match `/^[a-z0-9_]+$/` and be unique across both forms. Editors can
choose `events:signup` or `events:donation_completed` as binomial sources backed
by stored conversions with the corresponding `eventName`. Writable sources
accept both `trackConversion` and `trackConversionBeacon`; server-only sources
are recorded with `trackConversion`. Beacon conversions for a non-writable name
are dropped silently. Only listed names become `events:<name>` sources. They
support visitor and user units and do not represent counts or revenue in v1.

### Testing page SEO in the host

`pageKindSeoContract({ secret, original, versions, state, winner? })` from `/rsc`
returns `{ manifest, rows }`. States are `running`, `decided` and `archived`;
provide a winner path for the latter two. Build the host's test runtime with
`loadManifest: async () => manifest` and the same secret. For each row, set
`next/headers` to its signed `headers`, render metadata for `servedPath`, and
assert `expect.robots`, `expect.canonical` and `expect.inSitemap` against the
host's metadata and sitemap functions. This includes the Original served as
each version, including the homepage.

A host-level test mocks four boundaries: `next/headers`, the page loader,
the runtime and the site URL. Set `metadataBase` so relative canonical paths
resolve to your site URL.

### Whole-page options

| Option | Purpose |
| --- | --- |
| `pages.collections` | Optional array of `{ slug, pathOf, findByPath }`. `pathOf(doc)` derives a public path from the slug (used to protect live test paths); `findByPath(path, req)` resolves a published page to `{ id, published: true }`, or returns `null`. Start and readiness check every non-holdout version, including the Original. Registered collections must exist when this plugin runs. Localized publication status and field-level `beforeChange` hooks that rewrite paths after the collection guard are unsupported; derive paths from fields finalized before collection hooks. Without this option, readiness warns that pages are unchecked and Start keeps its existing behaviour. |

Do not swallow errors from nested updates of guarded page collections inside host hooks: a swallowed error leaves the guard's operation frame in place for the rest of the request because Payload's Local API does not call `afterError`.

For a collection with drafts enabled, use a published-only slug lookup with the
manager's request and `overrideAccess: false`:

```ts
pages: {
  collections: [{
    slug: 'pages',
    pathOf: doc => typeof doc.slug === 'string' ? `/${doc.slug}` : null,
    findByPath: async (path, req) => {
      const { docs } = await req.payload.find({
        collection: 'pages', req, overrideAccess: false, draft: false, depth: 0, limit: 1,
        where: { and: [
          { slug: { equals: path.slice(1) } },
          { _status: { equals: 'published' } },
        ] },
      })
      return docs[0] ? { id: docs[0].id, published: true } : null
    },
  }],
},
```

Adapt both callbacks for the site's homepage path. These checks run before Start;
they do not protect pages from later deletion, unpublishing or renaming. Keep an
archived winner published at the same address: archived test URLs still point to it.
Whole-page registrations also install the sidebar test status and content-change hooks.
For 0.4.0, run `payload migrate:create` for `xp_state.retired_slugs`,
`xp_experiments.page_collection` and its version column, then
`payload generate:importmap`.

`contentOf(doc)` optionally selects the content your site renders (for example,
`doc.layout`). Published copies are compared with nested `id` and `blockName`
keys removed. Without it, content checks and page content-change comparisons
are skipped. `copyHint` (up to 200 characters), `copyUrl` (a root-relative path)
and `copyLabel` (up to 40 characters, requires `copyUrl`) customize the guidance
for making version pages. The default copy link opens the registered collection's
list under the configured admin route.

### `admin` options

Host links and kind descriptions are optional. For a host using payload-puck's
editor route, public pages and a `puck-templates` collection:

| Option | Signature and behavior |
| --- | --- |
| `admin.previewUrl` | `(placement: PreviewPlacement) => string \| null \| undefined \| Promise<string \| null \| undefined>`. Receives `collection`, `id`, `title`, `published`, and optional `slug`. May be async; return `null` to hide preview for that placement. Each call has a 2 s limit, with at most 8 lookups awaited concurrently. |

For example, pass:

```ts
admin: {
  editorUrl: ({ collection, id, draft, editor, doc }) =>
    `/admin/puck-editor/${encodeURIComponent(collection)}/${encodeURIComponent(String(id))}`,
  previewUrl: async ({ collection, slug }) => {
    if (collection !== 'pages' || slug === undefined) return null
    // Match the site's public page routing, including its homepage convention.
    return slug === 'home' ? '/' : `/${slug}`
  },
  descriptions: {
    block: 'Try different content on a landing page.',
    document: 'Try different versions of a donation ask.',
    setting: 'Try a different signup or donation prompt.',
  },
}
```

`PreviewPlacement` is exported from the package root and `/rsc`. Its `slug` is
the published main row's string slug, including for a placement found in a newer
draft with a different slug. It is absent for unpublished documents. `published`
describes the placement's version; the callback receives no other document fields.
An async callback can also look up the public path by `collection` and `id` using
the host's own data access. The old `({ collection, id }) => string` form still works.

Preflight resolves the URL callbacks on the server for block placements and sends
only URL strings to the client. A null/undefined result, a non-string, an exception,
a rejected promise or a timeout leaves preview hidden for that placement. When an
editor URL exists, the admin offers "Edit on page"; when neither URL exists, it
omits the row. Timed-out host work cannot be cancelled and keeps its concurrency
slot until it settles; if all 8 slots remain occupied, further preview lookups
are skipped for that preflight. Kind descriptions are available to the server views through
`config.custom.xp`.

A flag point can also declare `description?: string` to explain the setting below its label.

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

The sidebar includes a **Tests** group with **All tests** and **Goals**. The
dashboard also includes **Tests** and **Goals** cards above its widgets. Goals
appears only for users who can manage tests. Both additions follow the host's
admin route and keep host-provided navigation and dashboard entries first.
After upgrading, run `payload generate:importmap` to register the dashboard card
component and the server nav wrapper.
A host nav group also labelled "Tests" shares Payload's NavGroup DOM id and open-state preference with the plugin's group, so pick another label.

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

Works with: payload-puck ≥0.10.3 (experiments ≥0.4.0).

For payload-puck hosts, add one integration object on each side. In the render
config, pass `integrations` to `extendConfig`:

```ts
import { extendConfig } from '@delmaredigital/payload-puck/config'
import { experimentsPuck } from '@delmaredigital/payload-experiments/puck'
import { baseConfig } from './baseConfig'

export const renderConfig = extendConfig({
  base: baseConfig,
  integrations: [experimentsPuck()],
})
```

Call `experimentsPuckEditor()` once at module scope in a `'use client'` module,
then pass that array to `PuckConfigProvider`. A new object per render rebuilds
Puck's config and plugin list.

```tsx
'use client'

import { PuckConfigProvider } from '@delmaredigital/payload-puck/client'
import { experimentsPuckEditor } from '@delmaredigital/payload-experiments/puck/editor'
import { editorConfig } from './editorConfig'

const integrations = [experimentsPuckEditor()]

export function PuckProvider({ children }: { children: React.ReactNode }) {
  return <PuckConfigProvider config={editorConfig} integrations={integrations}>
    {children}
  </PuckConfigProvider>
}
```

Each object includes the test block and its **A/B tests** sidebar category. The
editor object also includes the outline plugin: it hides empty version slots
that the block's test doesn't use, while content in unused slots stays visible
with a warning. Both helpers accept `{ routes }`; the editor also accepts
`accent`. Use the host's Payload routes and the plugin's `theme.accent`.

#### Wiring Puck by hand

The separate pieces stay exported:

- `/puck`: `ExperimentSlot`, `createExperimentSlot({ routes })`,
  `EXPERIMENT_SLOT_TYPE` and `createExperimentSlotField({ routes })`.
- `/puck/editor`: `ExperimentSlotEditor`,
  `createExperimentSlotEditor({ routes, accent })` and `experimentOutlinePlugin()`.

Register the render and editor blocks under the same `EXPERIMENT_SLOT_TYPE` key (import it from `/puck`),
add a sidebar category listing it, and add `experimentOutlinePlugin()` to Puck's
`plugins`. It composes with the host's outline override.

Routes default to Payload's `/admin` and `/api` when omitted. The existing
`ExperimentSlot` and `ExperimentSlotEditor` exports remain available with these
defaults. Hosts on non-default routes switch to the factories. The standalone
`createExperimentSlotField({ routes })` also accepts the host's routes.

Pass the same accent as the plugin's `theme.accent`: the editor cannot read
Payload config. Both use the same validator and report the same error for an
invalid colour. Without an accent the editor uses the neutral palette.

Load the editor stylesheet inside the Puck iframe. With Tailwind v4, add the
package import **after** Tailwind in the CSS that builds your editor iframe
stylesheet (the stylesheet listed in payload-puck's `editorStylesheets`):

```css
@import "tailwindcss";
@import "@delmaredigital/payload-experiments/puck/editor.css";
```

Alternatively, serve the exported `puck/editor.css` file from a public URL and
append that URL to payload-puck's `editorStylesheets`, after the host stylesheet.
The editor CSS includes its own light and dark palette, selected by
`data-theme="dark"` or the `dark` class on the iframe's `<html>`. The client component's CSS import alone
does not reach an iframe configured with `syncHostStyles: false`.

If Puck runs outside Payload's admin, the page needs Payload's admin styles (the plugin's tokens map onto them) and the plugin's admin styles, plus `data-theme="light"` or `data-theme="dark"` on `<html>`. Inside the admin all of this is already in place:

```css
@import "@payloadcms/next/css";
@import "@payloadcms/ui/styles.css";
@import "@delmaredigital/payload-experiments/admin/theme.css";
@import "@delmaredigital/payload-experiments/admin/ui.css";
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
- Content-change markers are recorded on publish only (on save for collections
  without drafts).
- Results cover the whole round; breakdowns by segment or dimension are not
  available in v1.

### Limits

| Capability | Limit |
|---|---|
| Make it the content: localized collections | not supported yet |
| Make it the content: field defaults | An update-denied field empty in both versions may publish its default because Payload applies defaults when reading. |

## Theme

The admin inherits Payload's neutral palette by default. Set one host accent:

```ts
theme: { accent: '#1f3a68' }
```

`theme.accent` accepts `#rgb` or `#rrggbb`; empty or undefined uses the default.
The plugin derives darker hover/active fills (clamped to keep text contrast), a
contrasting focus ring, and an opaque 8% subtle tint.
In dark mode it raises HSL lightness when needed to reach 3:1 against the
reference dark surface, then selects white or near-black foreground text.
The WCAG 2.x gate requires at least 4.5:1 **foreground text on the accent fill**
in each theme (the accent is used as a fill, not as page text). A failing
colour is refused with its ratio. Status chips retain Payload semantic colours.
`deriveAccent` is also exported from `/puck/editor` for editor integrations.
