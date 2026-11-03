import type { PayloadRequest } from 'payload'
import type { ExperimentsServerRuntime } from './runtime.js'
import type { ArmSlot } from './puck.js'
import type { TargetingOp } from '../targeting/ops.js'

export type DocId = string | number
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
  id: string; label: string; description?: string; params: Record<string, ParamField>; defaultParams: Record<string, unknown>
  placements?(args: { experimentId: DocId; arms: string[]; req: PayloadRequest }): Promise<Array<{ arm: string; ok: boolean; detail?: string }>>
  makeContent?(args: { experimentId: DocId; winner: { arm: string; params: Record<string, unknown> }; req: PayloadRequest }): Promise<void>
}
/** Host adapter: true permits the request; false drops it. */
export type RateLimiter = (args: { req: PayloadRequest; unitId: string }) => boolean | Promise<boolean>
export type ExperimentsAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>
export interface ExperimentsPluginOptions<TUser extends { id: string | number } = { id: string | number }> {
  runtime: ExperimentsServerRuntime<TUser>
  access: { manage: ExperimentsAccess; admin?: ExperimentsAccess; readResults?: ExperimentsAccess; readIdentities?: ExperimentsAccess }
  theme?: { accent?: string }
  admin?: {
    editorUrl?: (args: { collection: string; id: DocId; draft?: boolean }) => string
    previewUrl?: (args: { collection: string; id: DocId }) => string
    descriptions?: { block?: string; document?: string; setting?: string }
  }
  metricSources?: MetricSource[]
  eventSources?: Array<string | { name: string; clientWritable: boolean }>
  flagPoints?: FlagPoint[]
  attributeKeys?: Record<string, { type: 'string' | 'number' | 'boolean'; values?: string[] }>
  pages?: { collections: Array<{
    slug: string
    pathOf: (doc: Record<string, unknown>) => string | null
    /** Published-only lookup using the manager's req and overrideAccess: false. */
    findByPath: (path: string, req: PayloadRequest) => Promise<{ id: string | number; published: boolean } | null>
  }> }
  puck?: { enabled: boolean; collections: Array<string | { slug: string; field?: string }> }
  events?: { retentionDays?: number; maxBodyBytes?: number; rateLimit?: RateLimiter; dimensions?: string[] }
}
/** Options required by the route table; CORE-02c resolves optional defaults. */
export type ResolvedOptions<TUser extends { id: string | number } = { id: string | number }> = Omit<ExperimentsPluginOptions<TUser>, 'eventSources'> & {
  eventSources?: Array<{ name: string; clientWritable: boolean }>
}
