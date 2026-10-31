import type { Arm, DocId, ExposurePolicy, ExperimentKind, TargetingRule, UnitType } from './contracts.js'
export interface FlagDefault { winnerArm: string; params: Record<string, unknown>; experiment: DocId; decidedAt: string }
export interface Manifest {
  v: 1; revision: number; experiments: ManifestExperiment[]
  flagDefaults: Record<string, FlagDefault>
  archivedWinners: Record<string, string>
  archivedPages: Record<string, { slug: string; winnerPath: string }>
}
export interface ManifestExperiment {
  id: DocId; slug: string; kind: ExperimentKind; unitType: UnitType; status: 'running' | 'decided'
  phase: number; phaseKind: 'test' | 'rollout'; seed: string; flagPoint?: string
  coverage: number; arms: Array<Omit<Arm, 'label'>>; targeting: Array<TargetingRule & { type: 'string' | 'number' | 'boolean' }>
  layer?: { slug: string; slices: number[] }
  exposurePolicy: ExposurePolicy; winnerArm?: string; holdoutKey?: string; deferrable: boolean
}
