# @delmaredigital/payload-experiments

A/B testing for Payload CMS and Next.js, with results inside the admin and data
in your own Postgres database. Editors can test blocks, whole pages and
registered flag points, choose a winner, and make it the permanent content.
Results count people who actually saw the content, with checks for traffic
imbalances and metrics that must not get worse. Puck support is optional.

```sh
pnpm add @delmaredigital/payload-experiments
```

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
