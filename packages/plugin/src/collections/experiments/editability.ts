import type { Status } from '../../types/contracts.js'
import type { EditableField } from '../../types/admin.js'
import { XpNotImplemented } from '../../errors.js'

export const EDITABLE_BY_STATUS: Record<Status, readonly EditableField[]> = {
  draft: [], running: [], stopped: [], decided: [], archived: [],
}
export function isEditable(_status: Status, _field: EditableField): boolean {
  throw new XpNotImplemented('CORE-03')
}
