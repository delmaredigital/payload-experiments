import { isEditable } from '../../collections/experiments/editability.js'
import type { EditableField } from '../../types/admin.js'
import type { Arm, DocId, ExperimentKind, ExposurePolicy, Status, TargetingRule, UnitType } from '../../types/contracts.js'

/** The depth-zero collection document, including fields owned by the server. */
export interface TestDocument {
  id: DocId; name: string; slug: string; status: Status; kind: ExperimentKind; unitType: UnitType
  hypothesis?: string | null
  arms: Arm[]; targeting?: TargetingRule[] | null; allocation: number
  flagPoint?: string | null; exposurePolicy: ExposurePolicy
  metrics?: { primary?: DocId | null; secondary?: DocId[] | null; guardrails?: DocId[] | null } | null
  analysis?: {
    method?: 'sequential' | 'bayesian' | null; cuped?: 'auto' | 'off' | null
    minExposuresPerArm?: number | null; plannedDurationDays?: number | null
    attributionWindowHours?: number | null; sequentialTuningParameter?: number | null; reachPerDay?: number | null
  } | null
  [key: string]: unknown
}
export type TestDocumentPatch = Partial<Pick<TestDocument, EditableField>>

const EDITABLE_FIELDS: readonly EditableField[] = [
  'name', 'hypothesis', 'arms', 'targeting', 'allocation', 'flagPoint', 'metrics', 'analysis', 'exposurePolicy',
]

/** Drop unknown and locked keys even when the caller is untyped. Groups replace whole groups. */
export function editablePatch(status: Status, partial: TestDocumentPatch): TestDocumentPatch {
  return Object.fromEntries(EDITABLE_FIELDS.flatMap(field =>
    Object.hasOwn(partial, field) && partial[field] !== undefined && isEditable(status, field)
      ? [[field, partial[field]]] : []))
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, nested]) => nested !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => [key, canonical(nested)]))
  return value
}

/** Only changed top-level keys go on the wire; arrays and groups remain intact. */
export function changedPatch(saved: TestDocument, staged: TestDocumentPatch): TestDocumentPatch {
  return Object.fromEntries(Object.entries(editablePatch(saved.status, staged)).filter(([key, value]) =>
    JSON.stringify(canonical(saved[key])) !== JSON.stringify(canonical(value))))
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Payload validation details may be nested under errors[0].data or top-level data. */
export function payloadFieldErrors(envelope: unknown, section = '_section', fallback = "Couldn't save these changes. Try again."): Record<string, string> {
  const root = object(envelope)
  const errors = Array.isArray(root?.errors) ? root.errors : []
  const first = object(errors[0])
  const result: Record<string, string> = {}
  const addDetails = (data: unknown) => {
    const details = object(data)?.errors
    if (!Array.isArray(details)) return
    for (const detail of details) {
      const error = object(detail)
      if (typeof error?.message !== 'string') continue
      const path = typeof error.path === 'string' && error.path ? error.path : section
      result[path] = error.message
    }
  }
  addDetails(root?.data)
  for (const error of errors) addDetails(object(error)?.data)
  if (Object.keys(result).length === 0) result[section] = typeof first?.message === 'string' ? first.message : fallback
  return result
}
