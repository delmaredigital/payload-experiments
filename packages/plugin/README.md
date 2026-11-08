# @delmaredigital/payload-experiments

A/B testing for Payload CMS and Next.js, from the content you already manage. Test a block on a page, a whole page against another page, or a setting your developer makes testable. Pick a goal, including click goals you name and attach to buttons and links, then compare the Original with your new versions. Results appear in the admin: they count only people who actually saw the content, warn when traffic looks wrong, and check guardrail goals (goals you don't want to hurt). You pick a winner and can make it permanent. Your data stays in your own Postgres database. There is no vendor.

> ⚠️ Upgrading to 0.4? Run `payload migrate:create` for four nullable plugin columns (`xp_experiments.page_collection` and its `_xp_experiments_v` counterpart, `xp_phases.placement_docs`, `xp_state.retired_slugs`), plus the Experiment block and `xpGoal` columns if you adopt them, then `payload generate:importmap`. Saves on pages, blocks and Puck collections can now be refused while a test runs on them (`page-busy`, `interacting-tests`); Puck tests whose slot is only on a draft can't start until the page is published; host `metricSources` ids may not start with `click:`; `admin.editorUrl` now receives a required `editor` argument. See the [CHANGELOG's BREAKING section](https://github.com/delmaredigital/payload-experiments/blob/main/CHANGELOG.md).

## Install

```bash
pnpm add @delmaredigital/payload-experiments
```

### Requirements

Use Node.js `>=22.23.4`, the Next.js App Router, and Postgres through `@payloadcms/db-postgres` with transactions enabled. Puck is optional. Install the peers your application uses:

| Peer | Version |
| --- | --- |
| `payload`, `@payloadcms/db-postgres`, `@payloadcms/next`, `@payloadcms/ui` | `>=3.90.0 <4` |
| `next` | `>=16.4.1 <17` |
| `react`, `react-dom` | `>=19.2.1 <20` |
| `pg` | `>=8.13.0 <9` |
| `@puckeditor/core` (optional) | `>=0.24.0` |

## Quick Start

These examples use your existing Payload app and Pages collection. Imports starting with `@/` are files you supply; the rendering example uses Puck.

### 1. Set a secret and create the runtimes

Set a private `XP_SECRET` in your server environment. Create a shared `pg` pool for the same database as Payload, with a finite connection timeout:

```ts
// src/experiments/proxyRuntime.ts
import { Pool } from 'pg'
import {
  defineExperimentsProxyRuntime,
  createPostgresManifestLoader,
} from '@delmaredigital/payload-experiments/runtime/proxy'

const pool = new Pool({
  connectionString: process.env.DATABASE_URI,
  connectionTimeoutMillis: 5_000,
})
export const proxyRuntime = defineExperimentsProxyRuntime({
  secret: process.env.XP_SECRET!,
  apiRoute: '/api', // match Payload's routes.api
  loadManifest: createPostgresManifestLoader({ pool }),
})
```

```ts
// src/experiments/serverRuntime.ts
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
```

Keep the secret private and stable across deployments and instances. To rotate it, pass `secret: [newSecret, previousSecret]`, newest first. For a custom Postgres schema, pass the loader's `schemaName`.

### 2. Add the plugin

Add this to your existing `payload.config.ts` plugins array. Your permission check must return a boolean; grant it to the staff who will manage tests.

```ts
import { createExperimentsPlugin } from '@delmaredigital/payload-experiments'
import { serverRuntime } from '@/experiments/serverRuntime'
import { canManageTests } from '@/access/tests'
import { sharedRateLimit } from '@/experiments/rateLimit'

createExperimentsPlugin({
  runtime: serverRuntime,
  access: { manage: canManageTests },
  events: { rateLimit: sharedRateLimit },
})
```

Supply a shared rate limiter for your deployment: `events.rateLimit` receives
`{ req, unitId }` and returns `true` to permit or `false` to drop a request.
Keep identifying attributes out of `events.dimensions`. Use the proxy runtime's `cookie.consent` to enrol only after consent (`ExperimentsProxyRuntimeOptions`); `eraseUser(payload, { userId })` from `/rsc` handles privacy erasure (typed by that exported function).

### 3. Run migrations and generate the import map

Generate and review the migration in your host app, then apply it. Regenerate the import map so the Tests screens and goal pickers are available.

```bash
pnpm exec payload migrate:create
pnpm exec payload migrate
pnpm exec payload generate:importmap
```

### 4. Wire the Next.js proxy

Create your app's `proxy.ts`. This assigns the version to show and handles
whole-page rewrites.

```ts
// src/proxy.ts
import { createExperimentProxy } from '@delmaredigital/payload-experiments/proxy'
import { proxyRuntime } from '@/experiments/proxyRuntime'

export const proxy = createExperimentProxy(proxyRuntime)
```

### 5. Add a results cron route

Your host schedules and authenticates this route. Choose a budget below your platform's route timeout, and schedule regular calls so results refresh.

```ts
// src/app/api/cron/xp-results/route.ts
import { runResults } from '@delmaredigital/payload-experiments/rsc'
import { serverRuntime } from '@/experiments/serverRuntime'
import { isAuthorizedCronRequest } from '@/auth/cron'

export async function GET(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return new Response('Unauthorized', { status: 401 })
  }
  const payload = await serverRuntime.getPayload()
  const result = await runResults(payload, { budgetMs: 20_000 })
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
```

### 6. Render the assigned version

For Puck pages, resolve the saved content before rendering it. Your page loader and render config stay in your app; add the [Puck integration](#puck-optional). For a Payload blocks field, see [Payload blocks (without Puck)](#payload-blocks-without-puck).

```tsx
// src/components/TestedPage.tsx
import { after } from 'next/server'
import { Render } from '@puckeditor/core'
import {
  getAssignments, resolveExperimentData, recordExposures,
} from '@delmaredigital/payload-experiments/rsc'
import { serverRuntime } from '@/experiments/serverRuntime'
import { loadPage } from '@/pages/loadPage'
import { renderConfig } from '@/puck/renderConfig'

export async function TestedPage({ path }: { path: string }) {
  const page = await loadPage(path)
  const assignments = await getAssignments(serverRuntime)
  const { data, rendered } = resolveExperimentData(page.puckData, assignments)
  after(() => recordExposures(serverRuntime, rendered, assignments))
  return <Render config={renderConfig} data={data} />
}
```

Render this async component inside `<Suspense>` and outside `'use cache'`.
Only record the returned `rendered` list when you deliver that content. Keep
editor and preview renders out of this path. Use Next's default prefetch;
full prefetch of pages that count content on server render is unsupported.

## Running a test

1. Start from the content: add an **Experiment block** (in Puck's **A/B tests** category),
   or open **Tests** in the admin to test whole pages or a registered setting.
2. Keep the **Original**, use **Copy Original here** in Puck to make a version,
   and make your changes. For whole pages, use Payload's **Duplicate** action, give the
   copy its own address, publish it, then choose it as a version in the test.
3. Pick a **goal**: a signup, purchase, or a named click goal on a button or
   link. Add guardrail goals for outcomes you don't want to hurt.
4. Save, follow the setup checks, preview each version ([wire preview links](#preview-and-editor-links)), and **Start**. The
   results explain whether to keep running or choose a winner.
5. Use **Decide** to pick the winner, then **Make it the content** to make it permanent.
   You can also **Stop** to show everyone the Original; starting again begins
   a new round with fresh results.

A click tells you someone took an action; it doesn't prove they completed a purchase or signup. Use the outcome itself as a goal when you can measure it.

## What your app wires

### Proxy

Keep the [proxy from step 4](#4-wire-the-nextjs-proxy) on your public routes.
If you already have a proxy, compose with `resolveExperiments` and
`applyExperiments` from `/proxy`: forward the returned `requestHeaders` on
both normal responses and rewrites, then apply the returned cookies and headers.

### Whole-page tests

Add this to the plugin from step 2 for a drafts-enabled Pages collection:

```ts
pages: { collections: [{
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
}] }
```

Adapt both callbacks for your homepage. Add `contentOf: doc => doc.layout` to select content for comparison. Keep shipped winner pages published at the same address.
In dynamic `generateMetadata`, merge `await experimentMetadata(serverRuntime, path)` from `/rsc` **after** your own metadata so its canonical and robots settings win; keep it outside `'use cache'`. Use `experimentSitemapFilter` from `/rsc` in your sitemap.

### Preview and editor links

The setup checks in [Running a test, step 4](#running-a-test) get their preview links from `admin.previewUrl`. Add these options to the plugin, adapting the routes to your app:

```ts
admin: {
  previewUrl: ({ collection, slug }) => collection === 'pages' && slug !== undefined
    ? (slug === 'home' ? '/' : `/${slug}`) : null,
  editorUrl: ({ collection, id, editor }) => editor === 'puck'
    ? `/admin/puck-editor/${encodeURIComponent(collection)}/${encodeURIComponent(String(id))}`
    : `/admin/collections/${encodeURIComponent(collection)}/${encodeURIComponent(String(id))}`,
}
```

`previewUrl` receives `PreviewPlacement`: `collection`, `id`, `title`, `published`, and optional `slug` from the published page (absent for unpublished pages). Return `null` to hide preview. `editorUrl` receives `collection`, `id`, optional `draft` and `doc`, and `editor: 'puck' | 'blocks' | 'page'` to choose the editor route.

### Results schedule

The [route in step 5](#5-add-a-results-cron-route) runs results in your app.
On Vercel, add it to your cron configuration and check its authentication.
The host owns the schedule; the plugin does not use Payload jobs.

### Migrations

The schema belongs to your app. Repeat [step 3](#3-run-migrations-and-generate-the-import-map) after every upgrade that changes it, including fields you add to host blocks.

### Signing users in

If your site has logins, extend the [server runtime in step 1](#1-set-a-secret-and-create-the-runtimes)
with `getUser` for your session lookup and `attributesOf` for non-identifying
attributes such as `loggedIn` and `staff`. Identify staff so their visits don't
count. In the proxy runtime, supply `getUnit`: return `{ userId, attributes }`
from a verified session, with `loggedIn` and `staff` in `attributes`; return
known logged-out attributes when there is no session token, or set
`sessionUnknown: true` when a token still needs checking on the server.
Declare `staff: { type: 'boolean' }` in the plugin's `attributeKeys`.
Call `linkIdentity` at registration and after a successful sign-in:

```ts
import { linkIdentity } from '@delmaredigital/payload-experiments/rsc'
import { serverRuntime } from '@/experiments/serverRuntime'

// In your successful password, magic-link/code, or OAuth callback:
await linkIdentity(serverRuntime, { headers: request.headers, userId, verified: true })
```

`verified` is required: use `true` only when this request proves ownership of
the account in this browser. Registration without that proof uses `false`.
A session refresh or an account's verified-email flag is not proof here.

### Puck (optional)

For [steps 2](#2-add-the-plugin) and [6](#6-render-the-assigned-version), add
`puck: { enabled: true, collections: ['pages'] }` to the plugin. A collection
slug uses its `puckData` field; use `{ slug: 'pages', field: 'content' }` for another.
Works with `@delmaredigital/payload-puck >=0.10.3` and experiments `>=0.4.0`.

In your render config, import `experimentsPuck` from `/puck` and pass
`integrations: [experimentsPuck()]` to payload-puck's `extendConfig`. In a
`'use client'` editor module, import `experimentsPuckEditor` from `/puck/editor`,
create `const integrations = [experimentsPuckEditor()]` once at module scope,
and pass it to `PuckConfigProvider`. Pass your custom `routes` to both helpers.
Load this in your iframe stylesheet, after Tailwind if you use it, and list that stylesheet's URL in payload-puck's `editorStylesheets`:

```css
@import "@delmaredigital/payload-experiments/puck/editor.css";
```

### Payload blocks (without Puck)

Add `blocks: { collections: [{ slug: 'pages', field: 'layout' }] }` to the plugin from step 2. Add the wrapper to your host's blocks field, then repeat step 3:

```ts
import { createExperimentBlock } from '@delmaredigital/payload-experiments'
import { contentBlocks } from '@/blocks'

// In the Pages collection's fields array:
{ name: 'layout', type: 'blocks', blocks: [
  ...contentBlocks, createExperimentBlock({ blocks: contentBlocks }),
] }
```

Resolve before rendering, as in step 6:

```ts
import { after } from 'next/server'
import { getAssignments, resolveExperimentBlocks, recordExposures } from
  '@delmaredigital/payload-experiments/rsc'

const assignments = await getAssignments(serverRuntime)
const { blocks, rendered } = resolveExperimentBlocks(page.layout, assignments)
after(() => recordExposures(serverRuntime, rendered, assignments))
// Render `blocks` with your host's block renderer.
```

Use the same Suspense, preview and prefetch rules as step 6; record only `rendered` when delivering the content.

### Click goals on your blocks

After [step 2](#2-add-the-plugin), add a goal picker to your button or link block,
then repeat [step 3](#3-run-migrations-and-generate-the-import-map):

```tsx
import { xpGoalField } from '@delmaredigital/payload-experiments'

// Add xpGoalField() to the host block's fields array.
// In that block's renderer, put the saved value on the actual button or link:
<a href={href} data-xp-goal={xpGoal}>{label}</a>
```

For Puck components, use `xpGoalPuckField()` from `/puck` in the render fields
and `xpGoalPuckEditorField()` from `/puck/editor` in the editor fields; pass custom `routes` as
`xpGoalPuckEditorField({ routes })`. Editors name click goals in **Goals** or the picker. Mount the provider described below
to count clicks; put the main goal and guardrail goals in every version or
outside all tested content.

## How it fits a typical site

For a site with Puck Pages, signed-in users, a Vercel cron and staff who manage tests, the pieces usually live here:

| File | What belongs there |
| --- | --- |
| `src/experiments/proxyRuntime.ts` | Private secret, manifest pool and API route |
| `src/experiments/serverRuntime.ts` | Lazy Payload loader, session lookup and staff attributes |
| `src/payload.config.ts` | Plugin, staff permissions, shared limiter and Pages registration |
| `src/proxy.ts` | Version selection and whole-page rewrites |
| `src/app/api/cron/xp-results/route.ts`, `vercel.json` | Authenticated results route and schedule |
| `src/components/TestedPage.tsx` | Resolve Puck content and render the assigned version |
| `src/puck/renderConfig.ts`, `src/puck/EditorProvider.tsx` | Render/editor integrations and iframe CSS |
| `src/auth/callbacks.ts` | Identity linking after registration and proving sign-in |
| `src/blocks/Button.ts` and its renderer | Click-goal picker and button/link attribute |

## Flag points and metric sources

Register a stable point once; editors can run new tests on it without changing
your code. Add this option to the plugin from step 2:

```ts
flagPoints: [{
  id: 'signup-prompt', label: 'Signup prompt',
  params: { heading: { type: 'text', label: 'Heading', required: true } },
  defaultParams: { heading: 'Start learning' },
}]
```

Read it with `getFlagPoint(serverRuntime, 'signup-prompt')` from `/rsc`, render
its `params`, and call `await point.expose(point.arm)` only when you deliver
that version. Bind code to the point id. For simple outcome goals, register
`eventSources: [{ name: 'signup', clientWritable: false }]` and call
`trackConversion` from `/rsc` with `eventName`, a stable `idempotencyKey` and,
when needed, `userId` or request `headers`. Editors see **signup** in the goal picker.
For existing business data, supply `metricSources` adapters with `id`, `label`,
`kind`, `keyedBy` and `query`, returning one `{ unitId, value, ts: Date }` row
per event. Revenue belongs in trusted server code, never a browser beacon.

## Client counting for viewport and pageview tests

Pass server assignments through a provider around the rendered content:

```tsx
import { ExperimentsProvider, ExperimentPageview } from
  '@delmaredigital/payload-experiments/client'
import { toClientAssignments } from '@delmaredigital/payload-experiments/rsc'

<ExperimentsProvider value={toClientAssignments(assignments, { pathname })}>
  <ExperimentPageview />
  {children}
</ExperimentsProvider>
```

Use the served page's own pathname, including after a rewrite. Puck viewport
blocks count when visible; whole-page tests need `ExperimentPageview` on each
target page. The provider also enables click goals. Pass `apiRoute` if yours
isn't `/api`. Client readers need explicit `flagPoints` or `experiments`
allow-lists in `toClientAssignments`; reading alone never counts a visit.

## Theme

The admin follows Payload's light and dark themes. To use your own accent, add:

```ts
theme: { accent: '#1f3a68' }
```

Use a hex colour with three or six digits; colours without enough contrast are refused. Pass the same `accent` to `experimentsPuckEditor` for Puck.

## Access options

Callbacks receive `{ req }` and return a boolean or a promise of one.

| Option | Who it permits | Default |
| --- | --- | --- |
| `manage` | Create and run tests, manage goals and choose winners | Required |
| `admin` | Code tests and analysis-method changes | `manage` |
| `readResults` | Read results | `manage` |
| `readIdentities` | Read identity links | `admin` |

## License

[MIT](https://github.com/delmaredigital/payload-experiments/blob/main/LICENSE).
See the [statistics engine README](https://github.com/delmaredigital/payload-experiments/blob/main/packages/stats/README.md) for the methods behind the results.
