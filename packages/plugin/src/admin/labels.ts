import type { ArmKey, ExperimentKind, Status } from '../types/contracts.js'
import type { VerdictCode } from '../types/snapshot.js'
import { ARM_LABELS } from '../labels/arms.js'

export { ARM_LABELS }
export const STATUS_LABELS = {
  draft: 'Draft', running: 'Running', stopped: 'Stopped', decided: 'Decided', archived: 'Archived',
} satisfies Record<Status, string>
export const PHASE_KIND_LABELS = { test: 'during the test', rollout: 'after shipping' } as const
export const KIND_LABELS = {
  block: 'Block on a page', page: 'Whole page', flag: 'Setting in code', code: 'Developer code',
} satisfies Record<ExperimentKind, string>
export const VERDICT_LABELS = {
  unavailable: 'Results unavailable',
  'data-problem': 'Check the data',
  'guardrail-failing': 'An important outcome got worse',
  collecting: 'Collecting results',
  'original-better': 'The Original is better',
  'worse-none-better': 'No better option',
  winner: 'A winner',
  mixed: 'Mixed results',
  'keep-running': 'Keep running',
  'no-difference': 'No clear difference',
  'rollout-collecting': 'Collecting results after shipping',
  'rollout-readout': 'Results after shipping',
} satisfies Record<VerdictCode, string>

export function armLabel(key: string, storedLabel?: string): string {
  return Object.hasOwn(ARM_LABELS, key) ? ARM_LABELS[key as ArmKey] : storedLabel ?? key
}
export function statusLabel(status: Status): string { return STATUS_LABELS[status] }
export function phaseKindLabel(kind: 'test' | 'rollout'): string { return PHASE_KIND_LABELS[kind] }
export function verdictCodeLabel(code: VerdictCode): string { return VERDICT_LABELS[code] }
export function kindLabel(kind: ExperimentKind): string { return KIND_LABELS[kind] }
