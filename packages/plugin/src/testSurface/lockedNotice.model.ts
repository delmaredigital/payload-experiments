import type { Status } from '../types/contracts.js'
import type { EditableField } from '../types/admin.js'
import { LOCKED_MESSAGES } from './copy/common.js'

export function lockedReason(status: Status, field: string, table: Record<Status, readonly EditableField[]>): string | null {
  if (['slug', 'kind', 'unitType', 'layer'].includes(field)) return LOCKED_MESSAGES.creation
  if (table[status].some(editable => editable === field)) return null
  if (status === 'running') {
    if (field === 'allocation') return LOCKED_MESSAGES.runningAllocation
    if (field === 'metrics') return LOCKED_MESSAGES.runningMetrics
    return LOCKED_MESSAGES.running
  }
  if (status === 'decided') return LOCKED_MESSAGES.decided
  if (status === 'archived') return LOCKED_MESSAGES.archived
  return LOCKED_MESSAGES.other
}
