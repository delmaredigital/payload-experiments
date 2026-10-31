import type { PayloadRequest } from 'payload'
import type { ExperimentsServerRuntime } from './runtime.js'
import type { ArmSlot } from './puck.js'
import type { TargetingOp } from '../targeting/ops.js'

export type Attributes = Record<string, string | number | boolean>
export type ExposurePolicy = 'render' | 'viewport' | 'pageview' | 'manual'
export type ExperimentKind = 'block' | 'page' | 'flag' | 'code'
export type Status = 'draft' | 'running' | 'stopped' | 'decided' | 'archived'
export type UnitType = 'visitor' | 'user'
export type ArmKey = 'control' | 'variantA' | 'variantB' | 'variantC' | 'holdout'
export type ArmKind = 'control' | 'variant' | 'holdout'
export interface TargetingRule { attribute: string; op: TargetingOp; value: string | number | boolean | string[] }
export interface Arm { key: ArmKey; label: string; weight: number; kind: ArmKind; slot?: ArmSlot; params?: Record<string, unknown>; pageTarget?: string }
export interface ParamField {
  type: 'text' | 'textarea' | 'number' | 'checkbox' | 'select'
  label: string
  required?: boolean
  options?: Array<{ label: string; value: string }>
  min?: number
  max?: number
}
export interface MetricSource {
  id: string; label: string; kind: 'binomial' | 'count' | 'revenue'; keyedBy: UnitType; clientWritable?: boolean
  query(args: { from: Date; to: Date; unitIds?: string[] }): Promise<Array<{ unitId: string; value: number; ts: Date }>>
  covariate?(args: { units: Array<{ unitId: string; firstExposureTs: Date }>; lookbackDays: number }): Promise<Array<{ unitId: string; value: number }>>
}
export interface FlagPoint {
  id: string; label: string; params: Record<string, ParamField>; defaultParams: Record<string, unknown>
  placements?(args: { experimentId: string; arms: string[]; req: PayloadRequest }): Promise<Array<{ arm: string; ok: boolean; detail?: string }>>
  makeContent?(args: { experimentId: string; winner: { arm: string; params: Record<string, unknown> }; req: PayloadRequest }): Promise<void>
}
/** Host adapter: true permits the request; false drops it. */
export type RateLimiter = (args: { req: PayloadRequest; unitId: string }) => boolean | Promise<boolean>
export type ExperimentsAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>
export interface ExperimentsPluginOptions {
  runtime: ExperimentsServerRuntime
  access: { manage: ExperimentsAccess; admin?: ExperimentsAccess; readResults?: ExperimentsAccess; readIdentities?: ExperimentsAccess }
  metricSources?: MetricSource[]
  eventSources?: string[]
  flagPoints?: FlagPoint[]
  attributeKeys?: Record<string, { type: 'string' | 'number' | 'boolean'; values?: string[] }>
  puck?: { enabled: boolean; collections: string[] }
  events?: { retentionDays?: number; maxBodyBytes?: number; rateLimit?: RateLimiter }
}
/** Options required by the route table; CORE-02c resolves optional defaults. */
export type ResolvedOptions = ExperimentsPluginOptions
