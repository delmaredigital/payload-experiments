# @delmaredigital/experiments-stats

Most people want [@delmaredigital/payload-experiments](https://www.npmjs.com/package/@delmaredigital/payload-experiments); this package is the statistics engine it uses.

A pure TypeScript port of GrowthBook's MIT statistics and assignment code.
Functions are synchronous and deterministic, accept plain numbers, arrays and
objects, and have no runtime dependencies. The package covers assignment,
CUPED, sequential frequentist and Bayesian inference, sample-ratio mismatch,
power, and per-unit aggregation. It does not collect exposures or events.

```sh
pnpm add @delmaredigital/experiments-stats
```

```ts
import { assignArm } from '@delmaredigital/experiments-stats'

const arm = assignArm({
  seed: 'checkout|',
  unitId: 'opaque-unit-id',
  weights: [45, 45, 10],
  coverage: 0.5,
})
// arm is an index; -1 means outside allocation.
```

## Public API

Signatures below use the exported types in [src/types.ts](src/types.ts).
The export list is [src/index.ts](src/index.ts). Fixed-horizon reference tests
and numerical helpers under `src/internal/` are not public exports.

### Assignment

```ts
// SDK hash; unsupported versions return null. Plugin assignment uses version 2.
hash(seed: string, value: string, version: number): number | null
// Equal fractions for n variations.
getEqualWeights(n: number): number[]
// Test membership in a half-open [start, end) range.
inRange(n: number, range: VariationRange): boolean
// SDK ranges for fractional weights and coverage (undefined means 1).
getBucketRanges(numVariations: number, coverage: number | undefined, weights?: number[]): VariationRange[]
// First matching range index, or -1 when not enrolled.
chooseVariation(n: number, ranges: VariationRange[]): number
```

`VariationRange` is `[number, number]`.

### Plugin assignment helpers

```ts
// Validate non-negative integer weights summing to 100, then divide by 100.
armWeightsToFractions(weights: readonly number[]): number[]
// Compose SDK hash v2 and ranges; seed must end in '|'.
assignArm(args: { seed: string; unitId: string; weights: readonly number[]; coverage: number }): number
// Hash into one of 100 layer slices, numbered 0–99.
layerSlice(layerSlug: string, unitId: string): number
// Reuse the test phase's last range for holdout and construct the winner range.
rolloutBucketRanges(testWeights: readonly number[], coverage: number): { winner: VariationRange; holdout: VariationRange }
```

Weights total 100; holdout is an explicit last arm. Coverage is a separate
allocation fraction. Raising coverage widens each range without moving an
already enrolled unit to another arm. `rolloutBucketRanges` requires at least
two arms and a nonzero holdout. It reuses the test holdout range verbatim,
including floating-point endpoints; the winner range is
`[0, coverage * holdout[0])`. Pass the test phase's weights and coverage.

### Statistics

```ts
// Mean, including any regression adjustment.
statisticMean(s: TestStatistic): number
// Post-period mean before regression adjustment.
statisticUnadjustedMean(s: TestStatistic): number
// Per-unit variance, including any regression adjustment.
statisticVariance(s: TestStatistic): number
// Square root of the per-unit variance.
statisticStddev(s: TestStatistic): number
// Covariance from paired sums of products.
computeCovariance(n: number, a: BaseStatistic, b: BaseStatistic, sumOfProducts: number): number
// Joint CUPED coefficient for the compared arms.
computeTheta(a: RegressionAdjustedStatistic, b: RegressionAdjustedStatistic): number
// Apply joint theta; theta zero returns the unadjusted post statistics.
createThetaAdjustedStatistics(a: TestStatistic, b: TestStatistic): [TestStatistic, TestStatistic]
```

`BaseStatistic` is `ProportionStatistic` (`type: 'proportion'`, `n`, `sum`) or
`SampleMeanStatistic` (`type: 'sampleMean'`, `n`, `sum`, `sumSquares`).
`TestStatistic` also accepts `RegressionAdjustedStatistic`
(`type: 'regressionAdjusted'`, `n`, `post`, `pre`, `postPreSumOfProducts`,
`theta: number | null`). Pre and post must have the same statistic type.
CUPED is applied when the returned pair remains regression-adjusted.

### Effect moments

```ts
// Theta adjustment and relative (default) or absolute treatment-minus-control moments.
abTestMoments(a: TestStatistic, b: TestStatistic, differenceType?: DifferenceType): EffectMomentsResult
```

`DifferenceType` is `'relative' | 'absolute'`. `EffectMomentsResult` contains
`pointEstimate`, `standardError`, `pairwiseSampleSize` and `errorMessage`.

### Sequential frequentist tests

```ts
// Two-sided sequential interval and p-value.
sequentialTwoSidedTTest(a: TestStatistic, b: TestStatistic, config?: SequentialConfig): FrequentistTestResult
// One-sided interval for a treatment increase.
sequentialOneSidedTreatmentGreaterTTest(a: TestStatistic, b: TestStatistic, config?: SequentialConfig): FrequentistTestResult
// One-sided interval for a treatment decrease.
sequentialOneSidedTreatmentLesserTTest(a: TestStatistic, b: TestStatistic, config?: SequentialConfig): FrequentistTestResult
// Sequential tuning coefficient (two-sided by default).
sequentialRho(alpha: number, sequentialTuningParameter: number, twoSided?: boolean): number
// Two-sided interval halfwidth from variance and pairwise sample size.
sequentialIntervalHalfwidth(s2: number, n: number, sequentialTuningParameter: number, alpha: number, rho?: number): number
// One-sided interval halfwidth from variance and pairwise sample size.
sequentialIntervalHalfwidthOneSided(s2: number, n: number, sequentialTuningParameter: number, alpha: number, rho?: number): number
// Whether both CI bounds lie strictly on one side of zero.
isStatisticallySignificant(ci: readonly [number | null, number | null]): boolean
```

`FrequentistConfig` accepts `alpha` (default 0.05), `differenceType` (default
`'relative'`) and `testValue` (default 0). `SequentialConfig` adds
`sequentialTuningParameter` (default 5000) and an optional `rho` override.
`FrequentistTestResult` contains `expected`, `ci`, `pValue`, `uplift`,
`errorMessage` and `pValueErrorMessage`; `Uplift` has `dist: 'normal'`, `mean`
and `stddev`. One-sided intervals have an infinite open end; unavailable
bounds/p-values may be null. Check the error fields before interpreting results.
`PValueErrorMessage` is `NUMERICAL_PVALUE_NOT_CONVERGED` or
`ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST`.

### Bayesian tests

```ts
// Default improper Gaussian prior: { mean: 0, variance: 1, proper: false }.
DEFAULT_GAUSSIAN_PRIOR: Readonly<GaussianPrior>
// Gaussian effect posterior, credible interval, chance to win and risk.
effectBayesianABTest(a: TestStatistic, b: TestStatistic, config?: BayesianConfig): BayesianTestResult
```

`GaussianPrior` contains `mean`, `variance` and `proper`. `BayesianConfig`
accepts `alpha` (0.05), `differenceType` (`'relative'`), `inverse` (false),
`priorEffect` (`DEFAULT_GAUSSIAN_PRIOR`) and `priorType` (`'relative'`).
`BayesianTestResult` contains `expected`, `ci`, `uplift`, `chanceToWin`,
`risk: [number, number]`, `riskType` and `errorMessage`.

### Diagnostics

```ts
// Chi-square sample-ratio-mismatch p-value for counts and relative weights.
checkSrm(users: readonly number[], weights: readonly number[]): number
// Additional pairwise sample size needed for a target power/MDE.
midExperimentPower(moments: EffectMomentsResult, testResult: { errorMessage: string | null }, config: { alpha?: number; differenceType?: DifferenceType }, powerConfig?: MidExperimentPowerConfig): AdditionalSampleSizeNeededResult
```

`MidExperimentPowerConfig` accepts `targetPower`, `targetMde`, `numGoalMetrics`,
`numVariations`, `priorEffect`, `pValueCorrected`, `sequential` and
`sequentialTuningParameter`. `AdditionalSampleSizeNeededResult` contains
`additionalUsers`, `scalingFactor`, `upperBoundAchieved`, `updateMessage`,
`error` and `targetPower`.

### Pre-experiment power

```ts
// Frequentist power for a metric and total sample size across variations.
powerEstFrequentist(metric: PowerMetricParams, n: number, nVariations: number, alpha: number, twoTailed: boolean, sequentialTesting: false | number): number
// Frequentist power from an effect and its standard error.
powerFrequentist(effectSize: number, standardError: number, alpha: number, twoTailed: boolean): number
// Frequentist minimum detectable effect at the requested power.
findMdeFrequentist(metric: PowerMetricParams, power: number, n: number, nVariations: number, alpha: number, sequentialTesting: false | number): MdeResult
// Two-sided Bayesian power; relative selects prior scaling.
powerEstBayesian(metric: PowerMetricParams, alpha: number, nPerVariation: number, relative: boolean): number
// Bayesian minimum detectable effect; relative selects prior scaling.
findMdeBayesian(metric: PowerMetricParams, alpha: number, power: number, nPerVariation: number, relative: boolean): MdeResult
// Weekly power projections and sample-size/runtime thresholds for metrics.
powerMetricWeeks(input: PowerWeeksInput): PowerWeeksResult
```

`PowerMetricParams` is either `{ type: 'mean', mean, standardDeviation,
effectSize, prior? }` or `{ type: 'binomial', conversionRate, effectSize,
prior? }`, with numeric fields and an optional `GaussianPrior`. `MdeResult`
is `{ type: 'success', mde: number }` or `{ type: 'error', description: string }`.
`sequentialTesting` is false or the tuning parameter. Bayesian power uses
sample size per variation. The prior's variance is converted to a standard
deviation for upstream power calculations; absent prior uses the upstream
form default (mean 0, standard deviation 0.3, improper).

`PowerWeeksInput` contains `metrics`, `nVariations`, `nWeeks`, `alpha`,
`usersPerWeek`, `targetPower` and `method` (`{ type: 'frequentist',
sequentialTesting: false | number }` or `{ type: 'bayesian' }`).
`PowerWeeksResult` contains weekly users and per-metric effect/power/threshold
records, `sampleSizeAndRuntime` by metric, and optional `weekThreshold`.

### Capping, aggregation and multiple comparisons

```ts
// Linear-interpolated percentile; null for empty values; requires 0 < p < 1.
resolvePercentileCap(values: readonly number[], p: number): number | null
// Cap each per-unit value and retain capped/uncapped totals and counts.
capValues(values: readonly number[], threshold: number | null): CapResult
// Left-to-right per-unit n, sum and sumSquares.
summarizeUnits(values: readonly number[]): UnitMoments
// Also summarize equal-length pre-period covariates and cross-products.
summarizeUnitsWithCovariate(values: readonly number[], covariates: readonly number[]): UnitMomentsWithCovariate
// Binomial → proportion (sum = converters); count/revenue → sample mean.
buildStatistic(kind: 'binomial' | 'count' | 'revenue', m: UnitMoments): BaseStatistic
// Build pre/post statistics with theta null for subsequent CUPED adjustment.
buildRegressionAdjustedStatistic(kind: 'binomial' | 'count' | 'revenue', m: UnitMomentsWithCovariate): RegressionAdjustedStatistic
// Divide alpha by an integer number of comparisons k >= 1.
bonferroniAlpha(alpha: number, k: number): number
```

`UnitMoments` contains `n`, `sum` and `sumSquares`.
`UnitMomentsWithCovariate` adds `preSum`, `preSumSquares` and
`postPreSumOfProducts`. `CapResult` contains `values`, `threshold`,
`cappedCount`, `uncappedTotal` and `cappedTotal`.

## Interface notes

- Direction: frequentist effects are direction-free. For lower-is-better
  Bayesian metrics set `inverse: true`. This flips only `chanceToWin` and risk
  order; `expected` and `ci` remain raw treatment-minus-control effects.
- Sequential guardrails read CI bounds, never `pValue` or `testValue`.
  One-sided p-values are clamped diagnostics in `[1e-5, 0.4999]` or null,
  and their computation ignores `testValue`. For higher-is-better, harm is
  Lesser `ci[1] < 0`; safety is Greater `ci[0] > -t`. For lower-is-better,
  harm is Greater `ci[0] > 0`; safety is Lesser `ci[1] < t`. Here `t` is
  the relative threshold, or for absolute effects the threshold multiplied
  by `abs(statisticUnadjustedMean(control))`. Bayesian P(worse) is
  `1 - chanceToWin` with direction set; safety uses the same raw CI rules.
- `midExperimentPower` encodes already-powered as `scalingFactor === 0`
  and `updateMessage === 'successful'`, with `additionalUsers === null`.
  An unsuccessful result has `updateMessage === 'unsuccessful'`.
  `additionalUsers` counts both compared arms together, not users per arm.
  Non-convergence throws.
- `checkSrm`: omit excluded arms from both arrays; do not zero their counts
  or weights. Nonpositive weights are skipped in the statistic but still
  count toward degrees of freedom. Test phases include holdout; rollout
  uses weights `[100 - h, h]`. Zero total users returns 1.
- Cap before computing moments: `capValues` → `summarizeUnits` →
  `buildStatistic`. A null cap is identity (copied values, zero capped count).
  Values equal to the cap are not counted as capped. Apply the resolved cap
  to CUPED covariates too.
- Binomial inputs and binomial covariates must be per-unit 0/1 values.
  Builders require `sumSquares === sum` and `sum <= n` for post and pre.
  Convert repeated events to a per-unit indicator before aggregation.
- Rollout holdout membership depends on the original range's exact endpoints;
  use `rolloutBucketRanges` rather than recomputing from a holdout percentage.

## Accuracy and fixtures

The reference is GrowthBook at
`0553a68def700abbcaaca8f5096da913f197804c`: gbstats statistics/tests and
SciPy numerical distributions, SDK assignment functions, and shared
pre-experiment power functions. Parity uses
`|a − b| ≤ 1e-9 · max(1, |b|)`. SDK range fixtures are compared with
upstream's own `floor(n · 1e8) / 1e8` rule. Non-finite values and structured
result keys are checked explicitly.

From the workspace root, regenerate committed fixtures with:

```sh
pnpm parity:generate
```

Generation requires `uv` and provisions CPython 3.12 with the upstream
hash-pinned requirements, then installs gbstats at the pinned Git SHA.
See the [generator guide](../../scripts/gbstats-parity/README.md) for
`--only`, `--list`, interpreter overrides and temporary output directories.
Fixture generation requires network access; normal tests read committed JSON.

The weekly drift workflow runs Mondays at 06:17 UTC and supports manual
dispatch. It resolves GrowthBook `main` for every upstream source, generates
temporary fixtures and runs the numeric parity comparison. It reports
environment/generation failures separately from material changes, includes
failure logs in an issue, and fails the job on either. A passing run creates
no issue. It never rewrites committed fixtures or runs on PRs/pushes.

## Licence

MIT; see [LICENSE](../../LICENSE) and [NOTICE](NOTICE) for upstream attribution,
the source pin and ported paths. No `packages/*/enterprise` code is used.
