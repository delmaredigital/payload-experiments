import type { DocId, ExposurePolicy } from './contracts.js'
export interface Assignment {
  slug: string; experimentId: DocId; arm: string; phase: number; exposable: boolean; policy: ExposurePolicy
  source: 'header' | 'recomputed' | 'preview' | 'fallback'
}
export interface Assignments {
  archivedWinners: Record<string, string>
  revision: number; visitorId?: string; userId?: string; bySlug: Record<string, Assignment>
  flagPoints: Record<string, FlagPointResult>; staff: boolean; bot: boolean; preview: boolean; sessionUnknown: boolean; method: string
}
export interface FlagPointResult {
  arm: string; params: Record<string, unknown>; source: 'experiment' | 'default'
  experiment?: string; experimentId?: DocId; phase?: number; policy?: ExposurePolicy; exposable: boolean
}
export interface ClientAssignments {
  clickGoalsArmed?: boolean
  v: 1; revision: number; apiRoute: string
  experiments: Record<string, { arm: string; experimentId: DocId; phase: number; params: Record<string, unknown>; policy: ExposurePolicy; exposable: boolean }>
  flagPoints: Record<string, FlagPointResult>
  pageviews: Array<{ slug: string; phase: number; arm: string }>
}
export interface RenderedExposure { slug: string; arm: string; phase: number }
