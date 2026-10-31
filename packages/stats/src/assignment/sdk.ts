import type { VariationRange } from '../types.js'

/**
 * Source: sdk-js/src/util.ts hash @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function hash(seed: string, value: string, version: number): number | null {
  throw new Error('not implemented: hash')
}

/**
 * Source: sdk-js/src/util.ts getEqualWeights @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function getEqualWeights(n: number): number[] {
  throw new Error('not implemented: getEqualWeights')
}

/**
 * Source: sdk-js/src/util.ts inRange @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function inRange(n: number, range: VariationRange): boolean {
  throw new Error('not implemented: inRange')
}

/**
 * Source: sdk-js/src/util.ts getBucketRanges @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function getBucketRanges(numVariations: number, coverage: number | undefined, weights?: number[]): VariationRange[] {
  throw new Error('not implemented: getBucketRanges')
}

/**
 * Source: sdk-js/src/util.ts chooseVariation @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * −1 = not enrolled
 */
export function chooseVariation(n: number, ranges: VariationRange[]): number {
  throw new Error('not implemented: chooseVariation')
}
