export type VariationRange = [number, number]

export interface ProportionStatistic { readonly type: 'proportion'; readonly n: number; readonly sum: number }

export interface SampleMeanStatistic { readonly type: 'sampleMean'; readonly n: number; readonly sum: number; readonly sumSquares: number }

export type BaseStatistic = ProportionStatistic | SampleMeanStatistic

export interface RegressionAdjustedStatistic { readonly type: 'regressionAdjusted'; readonly n: number
  readonly post: BaseStatistic; readonly pre: BaseStatistic; readonly postPreSumOfProducts: number; readonly theta: number | null }

export type TestStatistic = BaseStatistic | RegressionAdjustedStatistic

export type DifferenceType = 'relative' | 'absolute'

export interface EffectMomentsResult { pointEstimate: number; standardError: number; pairwiseSampleSize: number; errorMessage: string | null }

export interface FrequentistConfig { alpha?: number; differenceType?: DifferenceType; testValue?: number }   // 0.05, 'relative', 0

export interface SequentialConfig extends FrequentistConfig { sequentialTuningParameter?: number; rho?: number } // 5000

export type PValueErrorMessage = 'NUMERICAL_PVALUE_NOT_CONVERGED' | 'ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST'

export interface Uplift { dist: 'normal'; mean: number; stddev: number }

export interface FrequentistTestResult { expected: number; ci: [number | null, number | null]   // one-sided: ±Infinity on the open end
  pValue: number | null; uplift: Uplift; errorMessage: string | null; pValueErrorMessage: PValueErrorMessage | null }

export interface GaussianPrior { mean: number; variance: number; proper: boolean }

export interface BayesianConfig { alpha?: number; differenceType?: DifferenceType; inverse?: boolean; priorEffect?: GaussianPrior
  priorType?: 'relative' | 'absolute' }                          // defaults 0.05, 'relative', false, DEFAULT_GAUSSIAN_PRIOR, 'relative'

export interface BayesianTestResult { expected: number; ci: [number, number]; uplift: Uplift; chanceToWin: number
  risk: [number, number]; riskType: 'relative' | 'absolute'; errorMessage: string | null }

export interface MidExperimentPowerConfig { targetPower?: number; targetMde?: number; numGoalMetrics?: number; numVariations?: number
  priorEffect?: GaussianPrior | null; pValueCorrected?: boolean; sequential?: boolean; sequentialTuningParameter?: number }

export interface AdditionalSampleSizeNeededResult { additionalUsers: number | null; scalingFactor: number | null
  upperBoundAchieved: boolean; updateMessage: string; error: string | null; targetPower: number }
  // already powered ⇔ scalingFactor === 0 && updateMessage === 'successful' (additionalUsers is null — upstream falsy check)
  // infeasible/error ⇔ updateMessage === 'unsuccessful'; additionalUsers is PAIRWISE (both compared arms), not per arm

export type PowerMetricParams =
  | { type: 'mean'; mean: number; standardDeviation: number; effectSize: number; prior?: GaussianPrior }
  | { type: 'binomial'; conversionRate: number; effectSize: number; prior?: GaussianPrior }
  // prior maps to upstream as metricPriorLiftMean = mean, metricPriorLiftStandardDeviation = sqrt(variance), metricProper = proper,
  // overrideMetricLevelSettings = false; absent prior ⇒ { mean: 0, sd: DEFAULT_PROPER_PRIOR_STDDEV = 0.3, proper: false } (upstream's form default;
  // an undefined prior would produce NaN upstream even when improper)

export type MdeResult = { type: 'success'; mde: number } | { type: 'error'; description: string }

export interface PowerWeeksInput { metrics: Record<string, PowerMetricParams>; nVariations: number; nWeeks: number; alpha: number
  usersPerWeek: number; targetPower: number; method: { type: 'frequentist'; sequentialTesting: false | number } | { type: 'bayesian' } }

export interface PowerWeeksResult { weeks: Array<{ users: number; metrics: Record<string, { effectSize: number; power: number; isThreshold: boolean }> }>
  sampleSizeAndRuntime: Record<string, { weeks: number; users: number } | undefined>; weekThreshold?: number }

export interface CapResult { values: number[]; threshold: number | null; cappedCount: number; uncappedTotal: number; cappedTotal: number }

export interface UnitMoments { n: number; sum: number; sumSquares: number }

export interface UnitMomentsWithCovariate extends UnitMoments { preSum: number; preSumSquares: number; postPreSumOfProducts: number }
