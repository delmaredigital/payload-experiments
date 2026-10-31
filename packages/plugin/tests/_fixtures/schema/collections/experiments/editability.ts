// Schema-only copy from main d292db4e74d036d15d012ce1b5892dc4ad1f5ba6; only external import paths adjusted.
import type { Status } from '../../../../../src/types/contracts.js'
import type { EditableField } from '../../../../../src/types/admin.js'

export const EDITABLE_BY_STATUS: Record<Status, readonly EditableField[]> = {
  draft: ['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'flagPoint', 'metrics', 'analysis', 'exposurePolicy'],
  stopped: ['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'metrics', 'analysis', 'exposurePolicy'],
  running: ['name', 'hypothesis'],
  decided: ['name', 'hypothesis'],
  archived: [],
}
export function isEditable(status: Status, field: EditableField): boolean {
  return EDITABLE_BY_STATUS[status].includes(field)
}
