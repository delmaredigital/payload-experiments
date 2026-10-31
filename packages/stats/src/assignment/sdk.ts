import type { VariationRange } from '../types.js'

/** Source: sdk-js/src/util.ts hashFnv32a @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c */
function hashFnv32a(str: string): number {
  let hval = 0x811c9dc5
  const l = str.length
  for (let i = 0; i < l; i++) {
    hval ^= str.charCodeAt(i)
    hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24)
  }
  return hval >>> 0
}

/**
 * Source: sdk-js/src/util.ts hash @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * Preserve v2's second FNV pass and v1's original biased algorithm verbatim.
 */
export function hash(seed: string, value: string, version: number): number | null {
  if (version === 2) return (hashFnv32a(hashFnv32a(seed + value) + '') % 10000) / 10000
  if (version === 1) return (hashFnv32a(value + seed) % 1000) / 1000
  return null
}

/**
 * Source: sdk-js/src/util.ts getEqualWeights @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function getEqualWeights(n: number): number[] {
  if (n <= 0) return []
  return new Array(n).fill(1 / n)
}

/**
 * Source: sdk-js/src/util.ts inRange @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 */
export function inRange(n: number, range: VariationRange): boolean {
  return n >= range[0] && n < range[1]
}

/**
 * Source: sdk-js/src/util.ts getBucketRanges @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * Upstream error logging and environment checks are omitted to keep this pure.
 * Preserve clamping, weights || equal (including JSON null), the length check,
 * the 0.99–1.01 sum fallback, and float accumulation (cumulative += w).
 */
export function getBucketRanges(numVariations: number, coverage: number | undefined, weights?: number[]): VariationRange[] {
  coverage = coverage === undefined ? 1 : coverage
  if (coverage < 0) coverage = 0
  else if (coverage > 1) coverage = 1

  const equal = getEqualWeights(numVariations)
  weights = weights || equal
  if (weights.length !== numVariations) weights = equal
  const totalWeight = weights.reduce((w, sum) => sum + w, 0)
  if (totalWeight < 0.99 || totalWeight > 1.01) weights = equal

  let cumulative = 0
  return weights.map(w => {
    const start = cumulative
    cumulative += w
    return [start, start + (coverage as number) * w]
  })
}

/**
 * Source: sdk-js/src/util.ts chooseVariation @ growthbook/growthbook 0553a68def700abbcaaca8f5096da913f197804c
 * −1 = not enrolled
 */
export function chooseVariation(n: number, ranges: VariationRange[]): number {
  for (let i = 0; i < ranges.length; i++) {
    if (inRange(n, ranges[i]!)) return i
  }
  return -1
}
