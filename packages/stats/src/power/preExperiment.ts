import type { PowerMetricParams, MdeResult, PowerWeeksInput, PowerWeeksResult } from '../types.js'

/**
 * Source: shared/src/power/power.ts powerEstFrequentist @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function powerEstFrequentist(metric: PowerMetricParams, n: number, nVariations: number, alpha: number, twoTailed: boolean, sequentialTesting: false | number): number {
  throw new Error('not implemented: powerEstFrequentist')
}

/**
 * Source: shared/src/power/power.ts powerFrequentist @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function powerFrequentist(effectSize: number, standardError: number, alpha: number, twoTailed: boolean): number {
  throw new Error('not implemented: powerFrequentist')
}

/**
 * Source: shared/src/power/power.ts findMdeFrequentist @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function findMdeFrequentist(metric: PowerMetricParams, power: number, n: number, nVariations: number, alpha: number, sequentialTesting: false | number): MdeResult {
  throw new Error('not implemented: findMdeFrequentist')
}

/**
 * Source: shared/src/power/power.ts powerEstBayesian @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function powerEstBayesian(metric: PowerMetricParams, alpha: number, nPerVariation: number, relative: boolean): number {
  throw new Error('not implemented: powerEstBayesian')
}

/**
 * Source: shared/src/power/power.ts findMdeBayesian @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * upstream is always two-sided; `relative` selects relative vs absolute prior scaling (powerMetricWeeks passes true)
 */
export function findMdeBayesian(metric: PowerMetricParams, alpha: number, power: number, nPerVariation: number, relative: boolean): MdeResult {
  throw new Error('not implemented: findMdeBayesian')
}

/**
 * Source: shared/src/power/power.ts powerMetricWeeks @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function powerMetricWeeks(input: PowerWeeksInput): PowerWeeksResult {
  throw new Error('not implemented: powerMetricWeeks')
}
