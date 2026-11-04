import type { Status } from '../../types/contracts.js'
import type { EditableField } from '../../types/admin.js'

export const EDITABLE_BY_STATUS: Record<Status, readonly EditableField[]> = {
  draft: ['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'flagPoint', 'metrics', 'analysis', 'exposurePolicy', 'pageCollection'],
  stopped: ['name', 'hypothesis', 'arms', 'targeting', 'allocation', 'metrics', 'analysis', 'exposurePolicy', 'pageCollection'],
  running: ['name', 'hypothesis'],
  decided: ['name', 'hypothesis'],
  archived: [],
}
export function isEditable(status: Status, field: EditableField): boolean {
  return EDITABLE_BY_STATUS[status].includes(field)
}
