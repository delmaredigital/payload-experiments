import type { PowerMetricParams, MdeResult, PowerWeeksInput, PowerWeeksResult } from '../types.js'
import { normalCdf, normalPpf } from '../internal/normal.js'

interface MetricParamsBase {
  name: string
  effectSize: number
  overrideMetricLevelSettings: boolean
  overridePriorLiftMean: number
  overridePriorLiftStandardDeviation: number
  overrideProper: boolean
  metricPriorLiftMean: number
  metricPriorLiftStandardDeviation: number
  metricProper: boolean
}
type MetricParams = MetricParamsBase & (
  | { type: 'mean'; mean: number; standardDeviation: number }
  | { type: 'binomial'; conversionRate: number }
)
interface PowerCalculationParams {
  metrics: Record<string, MetricParams>
  nVariations: number
  nWeeks: number
  alpha: number
  usersPerWeek: number
  targetPower: number
  statsEngineSettings: { type: 'frequentist' | 'bayesian'; sequentialTesting: false | number }
}
type SampleSizeAndRuntime = { weeks: number; users: number }
type Week = PowerWeeksResult['weeks'][number]

// Frozen API mapping: metric-level priors only; no org/form overrides.
// Upstream DEFAULT_PROPER_PRIOR_STDDEV = 0.3. An absent prior still needs
// a finite variance: upstream divides by it even for an improper prior.
function toUpstreamMetric(name: string, m: PowerMetricParams): MetricParams {
  const common = {
    name,
    effectSize: m.effectSize,
    overrideMetricLevelSettings: false,
    overridePriorLiftMean: 0,
    overridePriorLiftStandardDeviation: 0,
    overrideProper: false,
    metricPriorLiftMean: m.prior?.mean ?? 0,
    metricPriorLiftStandardDeviation: m.prior ? Math.sqrt(m.prior.variance) : 0.3,
    metricProper: m.prior?.proper ?? false,
  }
  return m.type === 'mean'
    ? { ...common, type: m.type, mean: m.mean, standardDeviation: m.standardDeviation }
    : { ...common, type: m.type, conversionRate: m.conversionRate }
}

/**
 * Source: shared/src/power/power.ts powerEstFrequentist @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * @stdlib normal.cdf/quantile are replaced by src/internal/normal.
 */
export function powerEstFrequentist(metric: PowerMetricParams, n: number, nVariations: number, alpha: number, twoTailed: boolean, sequentialTesting: false | number): number {
  return powerEstFrequentistUpstream(toUpstreamMetric('', metric), n, nVariations, alpha, twoTailed, sequentialTesting)
}

/**
 * Source: shared/src/power/power.ts findMdeFrequentist @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * @stdlib normal.cdf/quantile are replaced by src/internal/normal.
 */
export function findMdeFrequentist(metric: PowerMetricParams, power: number, n: number, nVariations: number, alpha: number, sequentialTesting: false | number): MdeResult {
  return findMdeFrequentistUpstream(toUpstreamMetric('', metric), power, n, nVariations, alpha, sequentialTesting)
}

/**
 * Source: shared/src/power/power.ts powerEstBayesian @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * @stdlib normal.cdf/quantile are replaced by src/internal/normal.
 * Always two-sided; relative selects upstream relative/absolute prior scaling.
 */
export function powerEstBayesian(metric: PowerMetricParams, alpha: number, nPerVariation: number, relative: boolean): number {
  return powerEstBayesianUpstream(toUpstreamMetric('', metric), alpha, nPerVariation, relative)
}

/**
 * Source: shared/src/power/power.ts findMdeBayesian @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * @stdlib normal.cdf/quantile are replaced by src/internal/normal.
 * Always two-sided; relative selects upstream relative/absolute prior scaling.
 */
export function findMdeBayesian(metric: PowerMetricParams, alpha: number, power: number, nPerVariation: number, relative: boolean): MdeResult {
  return findMdeBayesianUpstream(toUpstreamMetric('', metric), alpha, power, nPerVariation, relative)
}

/**
 * Source: shared/src/power/power.ts powerMetricWeeks @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * @stdlib normal.cdf/quantile are replaced by src/internal/normal.
 */
export function powerMetricWeeks(input: PowerWeeksInput): PowerWeeksResult {
  // metricValuesData is UI provenance only and is not used by upstream's calculation.
  return powerMetricWeeksUpstream({
    metrics: Object.fromEntries(Object.entries(input.metrics).map(([name, m]) => [name, toUpstreamMetric(name, m)])),
    nVariations: input.nVariations,
    nWeeks: input.nWeeks,
    alpha: input.alpha,
    usersPerWeek: input.usersPerWeek,
    targetPower: input.targetPower,
    statsEngineSettings: input.method.type === 'frequentist'
      ? input.method
      : { type: 'bayesian', sequentialTesting: false },
  })
}

// Calculation bodies and private helper names follow upstream step for step.
// Only the API adapters above and normal distribution implementation differ.
/**
 * delta method for relative difference
 *
 * @param varA Scalar control distribution variance.
 * @param meanA Scalar control mean.
 * @param nA Control sample size.
 * @param varB Scalar treatment distribution variance.
 * @param meanB Scalar treatment distribution mean.
 * @param nB Treatment sample size.
 * @param relative boolean indicator for relative effects.
 * @returns variance.
 */
// This is power.ts's delta-method formula, not gbstats utils.frequentist_variance.
function frequentistVariance(
  varA: number,
  meanA: number,
  nA: number,
  varB: number,
  meanB: number,
  nB: number,
  relative: boolean,
): number {
  if (relative) {
    return (
      varB / (Math.pow(meanA, 2) * nB) +
      (varA * Math.pow(meanB, 2)) / (Math.pow(meanA, 4) * nA)
    );
  } else {
    return varB / nB + varA / nA;
  }
}

function getMetricMean(metric: MetricParams): number {
  return metric.type === "mean" ? metric.mean : metric.conversionRate;
}

type PriorParams = {
  proper: boolean;
  priorLiftMean: number;
  priorLiftStandardDeviation: number;
};

function getMetricPriorParams(params: MetricParams): PriorParams {
  if (params.overrideMetricLevelSettings)
    return {
      proper: params.overrideProper,
      priorLiftMean: params.overridePriorLiftMean,
      priorLiftStandardDeviation: params.overridePriorLiftStandardDeviation,
    };

  return {
    proper: params.metricProper,
    priorLiftMean: params.metricPriorLiftMean,
    priorLiftStandardDeviation: params.metricPriorLiftStandardDeviation,
  };
}

function getMetricVariance(metric: MetricParams): number {
  return metric.type === "mean"
    ? Math.pow(metric.standardDeviation, 2)
    : metric.conversionRate * (1 - metric.conversionRate);
}

function powerStandardError(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean,
): number {
  const metricMean = getMetricMean(metric);
  const metricVariance = getMetricVariance(metric);
  return Math.sqrt(
    frequentistVariance(
      metricVariance,
      metricMean,
      nPerVariation,
      metricVariance,
      metricMean * (1 + metric.effectSize),
      nPerVariation,
      relative,
    ),
  );
}

// Keep the upstream private name without colliding with the public sequentialRho
// declaration in the frozen coverage scanner. The calculation is unchanged.
const sequentialRho = (
  alpha: number,
  sequentialTuningParameter: number,
): number => {
  return Math.sqrt(
    (-2 * Math.log(alpha) + Math.log(-2 * Math.log(alpha) + 1)) /
      sequentialTuningParameter,
  );
}

function sequentialDiscriminant(
  n: number,
  rho: number,
  alpha: number,
): number {
  return (
    (2 *
      (n * Math.pow(rho, 2) + 1) *
      Math.log(Math.sqrt(n * Math.pow(rho, 2) + 1) / alpha)) /
    Math.pow(n * rho, 2)
  );
}

function sequentialPowerSequentialVariance(
  variance: number,
  n: number,
  alpha: number,
  sequentialTuningParameter: number,
): number {
  const standardErrorSampleMean = Math.sqrt(variance / n);
  const rho = sequentialRho(alpha, sequentialTuningParameter);
  const partUnderRadical = sequentialDiscriminant(n, rho, alpha);
  const zSequential = Math.sqrt(n) * Math.sqrt(partUnderRadical);
  const zStar = normalPpf(1.0 - 0.5 * alpha);
  const standardErrorSequential =
    (standardErrorSampleMean * zSequential) / zStar;
  const vSequential = Math.pow(standardErrorSequential, 2);
  return n * vSequential;
}

function sequentialPowerStandardError(
  metric: MetricParams,
  n: number,
  nVariations: number,
  alpha: number,
  sequentialTuningParameter: number,
  relative: boolean,
): number {
  const metricMean = getMetricMean(metric);
  const metricVariance = getMetricVariance(metric);
  const v_rel = frequentistVariance(
    metricVariance,
    metricMean,
    n / nVariations,
    metricVariance,
    metricMean * (1.0 + metric.effectSize),
    n / nVariations,
    relative,
  );
  return Math.sqrt(
    sequentialPowerSequentialVariance(
      v_rel,
      (2 * n) / nVariations,
      alpha,
      sequentialTuningParameter,
    ),
  );
}

function getSequentialTuningParameter(
  sequentialTesting: false | number,
): number {
  let sequentialTuningParameter = 0.0;
  if (sequentialTesting !== false) {
    sequentialTuningParameter = sequentialTesting;
  }
  return sequentialTuningParameter;
}

/**
 * Performs power calculation
 *
 * @param effectSize Scalar lift (relative to the scalar mean of the distribution, expressed as percentage).
 * @param mean Scalar mean of the distribution.
 * @param variance Scalar variance of the distribution.
 * @param n Scalar sample size.
 * @param nVariations Scalar number of variations.
 * @param alpha false positive rate (default: 0.05).
 * @param twoTailed Binary indicator if the test is 1 or 2-tailed (default: true).
 * @returns Estimated power.
 */
function powerEstFrequentistUpstream(
  metric: MetricParams,
  n: number,
  nVariations: number,
  alpha: number = 0.05,
  twoTailed: boolean = true,
  sequentialTesting: false | number,
): number {
  let standardError = 0;
  const sequentialTuningParameter =
    getSequentialTuningParameter(sequentialTesting);
  if (sequentialTuningParameter > 0) {
    standardError = sequentialPowerStandardError(
      metric,
      n,
      nVariations,
      alpha,
      sequentialTuningParameter,
      true,
    );
  } else {
    standardError = powerStandardError(metric, n / nVariations, true);
  }
  return powerFrequentist(metric.effectSize, standardError, alpha, twoTailed);
}

/**
 * Source: shared/src/power/power.ts powerFrequentist @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * @stdlib normal.cdf/quantile are replaced by src/internal/normal.
 */
export function powerFrequentist(
  effectSize: number,
  standardError: number,
  alpha: number = 0.05,
  twoTailed: boolean = true,
): number {
  const zStar = twoTailed
    ? normalPpf(1.0 - 0.5 * alpha)
    : normalPpf(1.0 - alpha);

  const standardizedEffectSize = effectSize / standardError;
  const upperCutpoint = zStar - standardizedEffectSize;
  let power = 1 - normalCdf(upperCutpoint);
  if (twoTailed) {
    const lowerCutpoint = -zStar - standardizedEffectSize;
    power += normalCdf(lowerCutpoint);
  }
  return power;
}

/**
 * Calculates minimum detectable effect
 *
 * @param power desired power.
 * @param mean Scalar mean of the distribution.
 * @param variance Scalar variance of the distribution.
 * @param n Scalar sample size.
 * @param nVariations Scalar number of variations.
 * @param alpha false positive rate (default: 0.05).
 * @returns object of class MdeResult, containing type and either mde or description.
 */
function findMdeFrequentistUpstream(
  metric: MetricParams,
  power: number,
  n: number,
  nVariations: number,
  alpha: number = 0.05,
  sequentialTesting: false | number,
): MdeResult {
  // Error handling:
  if (power <= alpha) {
    const mdeResults: MdeResult = {
      type: "error",
      description: "power must be greater than alpha.",
    };
    return mdeResults;
  }
  const nA = n / nVariations;
  const z =
    normalPpf(1.0 - 0.5 * alpha) -
    normalPpf(1.0 - power);
  const m = getMetricMean(metric);
  let v = getMetricVariance(metric);
  const sequentialTuningParameter =
    getSequentialTuningParameter(sequentialTesting);
  if (sequentialTuningParameter > 0) {
    v = sequentialPowerSequentialVariance(
      getMetricVariance(metric),
      2 * nA,
      alpha,
      sequentialTuningParameter,
    );
  }
  //ensure the term under the radical is non-negative and that a positive solution exists.
  if (nA <= (v * z ** 2) / m ** 2) {
    const mdeResults: MdeResult = {
      type: "error",
      description:
        "need to increase number of users or reduce number of variations.",
    };
    return mdeResults;
  }
  const sigma2 = v / nA;
  const a_star = 1 - (z ** 2 * sigma2) / m ** 2;
  const b_star = -2 * m;
  const c_star = m ** 2 - z ** 2 * sigma2;
  const disc = b_star ** 2 - 4 * a_star * c_star;
  const sol_1 = (-b_star + Math.sqrt(disc)) / (2 * a_star);
  //const sol_2 = (-b_star - Math.sqrt(disc)) / (2 * a_star);
  const mdeResults: MdeResult = {
    type: "success",
    mde: (sol_1 - m) / m,
  };
  return mdeResults;
}

function powerMetricWeeksUpstream(
  powerSettings: PowerCalculationParams,
): PowerWeeksResult {
  // Upstream runtime uses rounded 80% power; targetPower only marks isThreshold.
  const sampleSizeAndRuntimeNumeric: number[] = []; //for each metric, the first week they achieve 80% power.
  const mySampleSizeAndRuntime: {
    [id: string]: SampleSizeAndRuntime | undefined;
  } = {};

  const metricThresholds: Record<string, number> = {};
  const weeks: Week[] = [...Array(powerSettings.nWeeks).keys()].map((idx) => ({
    users: (idx + 1) * powerSettings.usersPerWeek,
    metrics: {},
  }));

  Object.entries(powerSettings.metrics).forEach(([metricKey, thisMetric]) => {
    let thisMDENumeric = NaN;
    let thisSampleSizeAndRuntimeNumeric = 999;
    let lookingForSampleSizeAndRunTime = true;
    for (let j = 0; j < powerSettings.nWeeks; j++) {
      const n = powerSettings.usersPerWeek * (j + 1);
      /*initialize block-scoped variables*/
      let thisPower = 0.0;
      let thisMde: MdeResult = {
        type: "success",
        mde: -999,
      };
      if (powerSettings.statsEngineSettings.type === "frequentist") {
        thisPower = powerEstFrequentistUpstream(
          thisMetric,
          n,
          powerSettings.nVariations,
          powerSettings.alpha,
          true,
          powerSettings.statsEngineSettings.sequentialTesting,
        );
        thisMde = findMdeFrequentistUpstream(
          thisMetric,
          0.8,
          n,
          powerSettings.nVariations,
          powerSettings.alpha,
          powerSettings.statsEngineSettings.sequentialTesting,
        );
      } else {
        thisPower = powerEstBayesianUpstream(
          thisMetric,
          powerSettings.alpha,
          n / powerSettings.nVariations,
          true,
        );
        thisMde = findMdeBayesianUpstream(
          thisMetric,
          powerSettings.alpha,
          0.8,
          n / powerSettings.nVariations,
          true,
        );
      }
      if (
        Math.round(thisPower * 100) / 100 >= 0.8 &&
        lookingForSampleSizeAndRunTime
      ) {
        lookingForSampleSizeAndRunTime = false;
        thisSampleSizeAndRuntimeNumeric = j + 1;
      }
      if (thisMde.type === "success") {
        thisMDENumeric = thisMde.mde;
      }
      if (
        powerSettings.targetPower < thisPower &&
        metricThresholds[metricKey] === undefined
      )
        metricThresholds[metricKey] = j;
      weeks[j]!.metrics[metricKey] = {
        effectSize: thisMDENumeric,
        power: thisPower,
        isThreshold: metricThresholds[metricKey] === j,
      };
    }
    sampleSizeAndRuntimeNumeric.push(thisSampleSizeAndRuntimeNumeric);
    const thisSampleSizeAndRuntime =
      thisSampleSizeAndRuntimeNumeric !== 999
        ? {
            weeks: thisSampleSizeAndRuntimeNumeric,
            users: powerSettings.usersPerWeek * thisSampleSizeAndRuntimeNumeric,
          }
        : undefined;
    // Upstream assigns undefined here, which JSON fixtures cannot carry.
    // Omit the key: reads still give undefined, matching upstream and its JSON.
    if (thisSampleSizeAndRuntime !== undefined)
      mySampleSizeAndRuntime[metricKey] = thisSampleSizeAndRuntime;
  });
  const duration = Math.max(...sampleSizeAndRuntimeNumeric);

  const results: PowerWeeksResult = {
    sampleSizeAndRuntime: mySampleSizeAndRuntime,
    // Our PowerWeeksResult omits upstream's extra type: "success" key.
    weeks,
    ...(duration !== 999 ? { weekThreshold: duration } : {}),
  };
  return results;
}

/*******************/
function calculatePriorMean(
  priorMeanRel: number,
  mean: number,
  relative: boolean,
): number {
  return relative ? priorMeanRel : priorMeanRel * Math.abs(mean);
}

function calculatePriorVariance(
  priorVarianceRel: number,
  mean: number,
  relative: boolean,
): number {
  return relative ? priorVarianceRel : priorVarianceRel * Math.pow(mean, 2);
}

function calculatePriorMeanSpecified(
  metric: MetricParams,
  relative: boolean,
): number {
  const metricMean = getMetricMean(metric);
  return calculatePriorMean(
    getMetricPriorParams(metric).priorLiftMean,
    metricMean,
    relative,
  );
}

function calculatePriorVarianceSpecified(
  metric: MetricParams,
  relative: boolean,
): number {
  const metricMean = getMetricMean(metric);
  return calculatePriorVariance(
    Math.pow(getMetricPriorParams(metric).priorLiftStandardDeviation, 2),
    metricMean,
    relative,
  );
}

function calculatePriorMeanDGP(
  metric: MetricParams,
  relative: boolean,
): number {
  const metricMean = getMetricMean(metric);
  return calculatePriorMean(metric.effectSize, metricMean, relative);
}

function calculatePriorVarianceDGP(
  metric: MetricParams,
  relative: boolean,
): number {
  const metricMean = getMetricMean(metric);
  /*priorStandardDeviationDGP is 0 because we assume true fixed effect size*/
  const priorStandardDeviationDGP = 0;
  return calculatePriorVariance(
    Math.pow(priorStandardDeviationDGP, 2),
    metricMean,
    relative,
  );
}

// Function to estimate variance of tau hat conditional on tau
function estimateTauHatVariance(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean,
): number {
  const s = powerStandardError(metric, nPerVariation, relative);
  return Math.pow(s, 2);
}

// Function to calculate marginal variance of tau hat
function getMarginalVarianceTauHat(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean,
): number {
  const priorVarianceDGP = calculatePriorVarianceDGP(metric, relative);
  const tauHatVariance = estimateTauHatVariance(
    metric,
    nPerVariation,
    relative,
  );
  return tauHatVariance + priorVarianceDGP;
}

// Function to calculate posterior precision
function getPosteriorPrecision(
  metric: MetricParams,
  nPerVariation: number,
  relative: boolean,
): number {
  const priorVarianceSpecified = calculatePriorVarianceSpecified(
    metric,
    relative,
  );
  const tauHatVariance = estimateTauHatVariance(
    metric,
    nPerVariation,
    relative,
  );
  const properInt = getMetricPriorParams(metric).proper ? 1 : 0;
  return 1 / tauHatVariance + properInt / priorVarianceSpecified;
}

function getCutpoint(
  metric: MetricParams,
  alpha: number,
  nPerVariation: number,
  relative: boolean,
  upper: boolean,
): number {
  const priorMeanSpecified = calculatePriorMeanSpecified(metric, relative);
  const priorVarianceSpecified = calculatePriorVarianceSpecified(
    metric,
    relative,
  );
  const priorMeanDGP = calculatePriorMeanDGP(metric, relative);
  const tauHatVariance = estimateTauHatVariance(
    metric,
    nPerVariation,
    relative,
  );
  const posteriorPrecision = getPosteriorPrecision(
    metric,
    nPerVariation,
    relative,
  );
  const marginalVarianceTauHat = getMarginalVarianceTauHat(
    metric,
    nPerVariation,
    relative,
  );
  const proper = getMetricPriorParams(metric).proper;
  return calculateCutpoint(
    alpha,
    upper,
    proper,
    tauHatVariance,
    posteriorPrecision,
    priorMeanSpecified,
    priorVarianceSpecified,
    priorMeanDGP,
    marginalVarianceTauHat,
  );
}

function calculateCutpoint(
  alpha: number,
  upper: boolean,
  proper: boolean,
  tauHatVariance: number,
  posteriorPrecision: number,
  priorMeanSpecified: number,
  priorVarianceSpecified: number,
  priorMeanDGP: number,
  marginalVarianceTauHat: number,
): number {
  const zStar = normalPpf(1.0 - 0.5 * alpha);
  const upperSign = upper ? 1 : -1;
  const properInt = proper ? 1 : 0;
  const numerator =
    upperSign * tauHatVariance * Math.sqrt(posteriorPrecision) * zStar -
    (properInt * (tauHatVariance * priorMeanSpecified)) /
      priorVarianceSpecified -
    priorMeanDGP;
  const denominator = Math.sqrt(marginalVarianceTauHat);
  return numerator / denominator;
}

/**
 * Performs power calculation
 *
 * @param metric an object of class MetricParams that has info about prior mean and sd, metric mean and sd, and effect size.
 * @param alpha false positive rate (default: 0.05).
 * @param nPerVariation sample size per variation.
 * @param relative boolean indicator if relative inference is desired.
 * @returns Estimated power.
 */
function powerEstBayesianUpstream(
  metric: MetricParams,
  alpha: number,
  nPerVariation: number,
  relative: boolean,
): number {
  const upperCutpoint = getCutpoint(
    metric,
    alpha,
    nPerVariation,
    relative,
    true,
  );
  const lowerCutpoint = getCutpoint(
    metric,
    alpha,
    nPerVariation,
    relative,
    false,
  );
  const powerPos = 1.0 - normalCdf(upperCutpoint);
  const powerNeg = normalCdf(lowerCutpoint);
  return powerPos + powerNeg;
}

/**
 * Performs mde calc
 * @param metric an object of class MetricParams that has info about prior mean and sd, metric mean and sd, and effect size.
 * @param alpha false positive rate (default: 0.05).
 * @param nPerVariation sample size per variation.
 * @param relative boolean indicator if relative inference is desired.
 * @param stepSize step size used in initial grid search.
 * @returns object of class MdeResult, containing type and either mde or description.
 */
function sweepGridFine(
  metric: MetricParams,
  alpha: number,
  power: number,
  nPerVariation: number,
  relative: boolean,
  stepSize: number,
): MdeResult {
  const effectSize = metric.effectSize;
  const stepSizeFiner = stepSize / 100;
  const lowerBound = effectSize - stepSize;
  for (
    let effectSizeFiner = lowerBound;
    effectSizeFiner < effectSize;
    effectSizeFiner += stepSizeFiner
  ) {
    metric.effectSize = effectSizeFiner;
    const p = powerEstBayesianUpstream(metric, alpha, nPerVariation, relative);
    if (p >= power) {
      const mdeResults: MdeResult = {
        type: "success",
        mde: effectSizeFiner,
      };
      return mdeResults;
    }
  }
  const mdeResults: MdeResult = {
    type: "error",
    description: "MDE achieving power = 0.8 does not exist in this range. ",
  };
  return mdeResults;
}

/**
 * Performs mde calc
 * @param metric an object of class MetricParams that has info about prior mean and sd, metric mean and sd, and effect size.
 * @param alpha false positive rate (default: 0.05).
 * @param nPerVariation sample size per variation.
 * @param relative boolean indicator if relative inference is desired.
 * @returns object of class MdeResult, containing type and either mde or description.
 */
function findMdeBayesianUpstream(
  metric: MetricParams,
  alpha: number,
  power: number,
  nPerVariation: number,
  relative: boolean,
): MdeResult {
  /*fixed effect size, so prior variance of DGP is 0*/
  let effectSize = 0;
  const dummyMetric = { ...metric, effectSize: effectSize };
  dummyMetric.effectSize = effectSize;
  let currentPower = powerEstBayesianUpstream(
    dummyMetric,
    alpha,
    nPerVariation,
    relative,
  );
  /*case where 0 effect size results in at least 80% power*/
  if (currentPower >= power) {
    const mdeResults: MdeResult = {
      type: "success",
      mde: effectSize,
    };
    return mdeResults;
  }
  const stepSizeCoarse = 1e-3;
  // Upstream uses normal.pdf(0, 0, 1) from @stdlib/stats 0.1.1, which may
  // differ by one ulp. Every threshold comparison using it has a relative
  // margin > 1e-11 (L8 review); the train records stdlib's actual value.
  const INV_SQRT_TWO_PI = 1 / Math.sqrt(2 * Math.PI);
  const maxError = INV_SQRT_TWO_PI * stepSizeCoarse;
  /*using integer of 5000 for stability in loop;
  combined with stepsize of 1e-3, max effectSize is 500%*/
  const numIters = 5000;
  for (let i = 0; i < numIters; i++) {
    effectSize = stepSizeCoarse * i;
    dummyMetric.effectSize = effectSize;
    currentPower = powerEstBayesianUpstream(
      dummyMetric,
      alpha,
      nPerVariation,
      relative,
    );
    if (currentPower >= power - maxError) {
      const currentPowerFine = sweepGridFine(
        dummyMetric,
        alpha,
        power,
        nPerVariation,
        relative,
        stepSizeCoarse,
      );
      if (currentPowerFine.type === "success") {
        return currentPowerFine;
      }
    }
  }
  /*case where mde is greater than 500% or doesn't exist*/
  const mdeResults: MdeResult = {
    type: "error",
    description: "MDE achieving power = 0.8 does not exist. ",
  };
  return mdeResults;
}
