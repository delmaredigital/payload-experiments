import type { FlagPoint, MetricSource } from './types/contracts.js'
export function defineFlagPoint<T extends FlagPoint>(p: T): T { return p }
export function defineMetricSource<T extends MetricSource>(s: T): T { return s }
