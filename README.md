# payload-experiments

No-code A/B testing for [Payload CMS](https://payloadcms.com) and Next.js, with honest statistics inside the admin and no vendor.

| Package | npm | What it is |
|---|---|---|
| [`@delmaredigital/payload-experiments`](packages/plugin) | pending | The Payload plugin: experiments, layers, metrics, events, Next.js runtime, results, admin views, optional Puck slot |
| [`@delmaredigital/experiments-stats`](packages/stats) | pending | Pure TypeScript statistics engine (GrowthBook `gbstats` port): assignment hashing, sequential and fixed-horizon tests, Bayesian effects, CUPED, SRM, power |

**Status:** design complete, implementation in progress. Not yet published. Design: [`docs/plans/2026-10-30-payload-experiments-design.md`](docs/plans/2026-10-30-payload-experiments-design.md).

## Why

Existing Payload A/B plugins route traffic and then hand "did it win?" to GA4 or PostHog. This plugin logs real exposures, measures the host's real outcomes through a small adapter interface, computes results with sequential-safe statistics validated against `gbstats`, and shows a plain-English verdict to the editor who created the test.

## Development

```bash
pnpm install
pnpm check     # typecheck + tests (including gbstats parity)
pnpm build
```

See `AGENTS.md` for conventions and gates.

## License

MIT. Statistics methods are ported from [GrowthBook](https://github.com/growthbook/growthbook) `gbstats` (MIT, © GrowthBook, Inc.); see `packages/stats/NOTICE`.
