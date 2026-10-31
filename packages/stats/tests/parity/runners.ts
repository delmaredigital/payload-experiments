import { hash, getEqualWeights, inRange, getBucketRanges, chooseVariation } from '../../src/assignment/sdk.js'
import { armWeightsToFractions, assignArm, layerSlice, rolloutBucketRanges } from '../../src/assignment/plugin.js'
import { statisticMean, statisticUnadjustedMean, statisticVariance, statisticStddev, computeCovariance, computeTheta, createThetaAdjustedStatistics } from '../../src/statistics.js'
import { abTestMoments } from '../../src/effectMoments.js'
import { sequentialTwoSidedTTest, sequentialOneSidedTreatmentGreaterTTest, sequentialOneSidedTreatmentLesserTTest, sequentialRho, sequentialIntervalHalfwidth, sequentialIntervalHalfwidthOneSided, isStatisticallySignificant } from '../../src/frequentist/sequential.js'
import { effectBayesianABTest } from '../../src/bayesian.js'
import { checkSrm } from '../../src/diagnostics/srm.js'
import { midExperimentPower } from '../../src/diagnostics/midExperimentPower.js'
import { powerEstFrequentist, powerFrequentist, findMdeFrequentist, powerEstBayesian, findMdeBayesian, powerMetricWeeks } from '../../src/power/preExperiment.js'
import { resolvePercentileCap, capValues } from '../../src/capping.js'
import { summarizeUnits, summarizeUnitsWithCovariate, buildStatistic, buildRegressionAdjustedStatistic, bonferroniAlpha } from '../../src/aggregate.js'
import { twoSidedTTest, oneSidedTreatmentGreaterTTest, oneSidedTreatmentLesserTTest } from '../../src/reference/fixedHorizon.js'
import { normalCdf, normalSf, normalPpf } from '../../src/internal/normal.js'
import { tCdf, tPpf } from '../../src/internal/studentT.js'
import { chi2Sf } from '../../src/internal/gamma.js'
import { truncatedNormalMean } from '../../src/internal/truncatedNormal.js'
import { frequentistDiff, frequentistVariance, varianceOfRatios, gaussianCredibleInterval } from '../../src/internal/utils.js'

export const runners: Record<string, (...args: any[]) => unknown> = {
  'hash': hash,
  'getEqualWeights': getEqualWeights,
  'inRange': inRange,
  'getBucketRanges': getBucketRanges,
  'chooseVariation': chooseVariation,
  'armWeightsToFractions': armWeightsToFractions,
  'assignArm': assignArm,
  'layerSlice': layerSlice,
  'rolloutBucketRanges': rolloutBucketRanges,
  'statisticMean': statisticMean,
  'statisticUnadjustedMean': statisticUnadjustedMean,
  'statisticVariance': statisticVariance,
  'statisticStddev': statisticStddev,
  'computeCovariance': computeCovariance,
  'computeTheta': computeTheta,
  'createThetaAdjustedStatistics': createThetaAdjustedStatistics,
  'abTestMoments': abTestMoments,
  'sequentialTwoSidedTTest': sequentialTwoSidedTTest,
  'sequentialOneSidedTreatmentGreaterTTest': sequentialOneSidedTreatmentGreaterTTest,
  'sequentialOneSidedTreatmentLesserTTest': sequentialOneSidedTreatmentLesserTTest,
  'sequentialRho': sequentialRho,
  'sequentialIntervalHalfwidth': sequentialIntervalHalfwidth,
  'sequentialIntervalHalfwidthOneSided': sequentialIntervalHalfwidthOneSided,
  'isStatisticallySignificant': isStatisticallySignificant,
  'effectBayesianABTest': effectBayesianABTest,
  'checkSrm': checkSrm,
  'midExperimentPower': midExperimentPower,
  'powerEstFrequentist': powerEstFrequentist,
  'powerFrequentist': powerFrequentist,
  'findMdeFrequentist': findMdeFrequentist,
  'powerEstBayesian': powerEstBayesian,
  'findMdeBayesian': findMdeBayesian,
  'powerMetricWeeks': powerMetricWeeks,
  'resolvePercentileCap': resolvePercentileCap,
  'capValues': capValues,
  'summarizeUnits': summarizeUnits,
  'summarizeUnitsWithCovariate': summarizeUnitsWithCovariate,
  'buildStatistic': buildStatistic,
  'buildRegressionAdjustedStatistic': buildRegressionAdjustedStatistic,
  'bonferroniAlpha': bonferroniAlpha,
  'reference/fixedHorizon#twoSidedTTest': twoSidedTTest,
  'reference/fixedHorizon#oneSidedTreatmentGreaterTTest': oneSidedTreatmentGreaterTTest,
  'reference/fixedHorizon#oneSidedTreatmentLesserTTest': oneSidedTreatmentLesserTTest,
  'internal/normal#normalCdf': normalCdf,
  'internal/normal#normalSf': normalSf,
  'internal/normal#normalPpf': normalPpf,
  'internal/studentT#tCdf': tCdf,
  'internal/studentT#tPpf': tPpf,
  'internal/gamma#chi2Sf': chi2Sf,
  'internal/truncatedNormal#truncatedNormalMean': truncatedNormalMean,
  'internal/utils#frequentistDiff': frequentistDiff,
  'internal/utils#frequentistVariance': frequentistVariance,
  'internal/utils#varianceOfRatios': varianceOfRatios,
  'internal/utils#gaussianCredibleInterval': gaussianCredibleInterval,
}
