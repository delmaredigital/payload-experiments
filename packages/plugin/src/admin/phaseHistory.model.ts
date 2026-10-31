import { phaseKindLabel } from './labels.js'
import { HISTORY_COPY, roundRow } from './copy/history.js'

export type HistoryPhase = {
  phase: number; phaseKind: 'test' | 'rollout'; startedAt: string; endedAt?: string | null;
  arms: readonly { weight: number }[]
}
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
export function phaseHistory(phases: readonly HistoryPhase[], decision?: { decidedBy?: unknown } | null) {
  return {
    rows: [...phases].sort((a, b) => a.phase - b.phase || new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()).map(phase => ({
      phase: phase.phase,
      phaseKind: phase.phaseKind,
      text: roundRow(phase.phase, phaseKindLabel(phase.phaseKind), dateFormat.format(new Date(phase.startedAt)),
        phase.endedAt ? dateFormat.format(new Date(phase.endedAt)) : HISTORY_COPY.now, phase.arms.map(arm => arm.weight).join('/')),
    })),
    decision: decision?.decidedBy != null ? HISTORY_COPY.decided : null,
  }
}
