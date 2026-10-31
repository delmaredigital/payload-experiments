// Schema-only copy of CORE-02a ba8d1c703430d8908f13a3669a31f8e3bfb8a9b5; only external import paths adjusted.
import type { Status } from '../../../../../src/types/contracts.js'
import type { EditableField } from '../../../../../src/types/admin.js'
import { XpNotImplemented } from '../../../../../src/errors.js'

export const EDITABLE_BY_STATUS: Record<Status, readonly EditableField[]> = {
  draft: [], running: [], stopped: [], decided: [], archived: [],
}
export function isEditable(_status: Status, _field: EditableField): boolean {
  throw new XpNotImplemented('CORE-03')
}
