import type { Arm, Status, UnitType } from '../types/contracts.js'
import { armLabel } from './labels.js'
import { eachVersion, groupShare, holdoutClause, holdoutRemainder, layerSentence, participation, peopleLabel, uncounted } from './copy/audience.js'

export type AllocationGroup = Pick<Arm, 'key' | 'weight' | 'kind'> & { label?: string }
export type AllocationLayer = { name: string; used: number; free: number }
const percent = (value: number) => String(Math.round(value * 10) / 10)

export function allocationSentence({ allocation, unitType, arms, layer, status }: {
  allocation: number; unitType: UnitType; arms: readonly AllocationGroup[]; layer?: AllocationLayer; status: Status
}): string {
  const groups = arms.filter(group => group.kind !== 'holdout')
  if (!groups.length || !Number.isFinite(allocation)) return ''
  const equal = groups.every(group => group.weight === groups[0]!.weight)
  const shares = equal ? eachVersion(percent(allocation * groups[0]!.weight / 100))
    : groups.map(group => groupShare(percent(allocation * group.weight / 100), armLabel(group.key, group.label))).join(', ')
  const holdout = arms.find(group => group.kind === 'holdout')
  let sentence = participation(percent(allocation), peopleLabel[unitType], shares) + (holdout ? holdoutClause(percent(holdout.weight)) : '')
    + (allocation < 100 ? holdout ? holdoutRemainder : uncounted : '')
  if ((holdout || layer || status === 'running') && !sentence.endsWith('.')) sentence += '.'
  if (layer) sentence += layerSentence(layer.name, layer.used, layer.free)
  return sentence
}

// Payload arrays are flattened into row fields; their parent value is a row count.
export function allocationGroups(fields: Record<string, { value?: unknown }>, path = 'arms'): AllocationGroup[] {
  const direct = fields[path]?.value
  if (Array.isArray(direct)) return direct as AllocationGroup[]
  const rows = new Map<number, Record<string, unknown>>()
  for (const [key, field] of Object.entries(fields)) {
    if (!key.startsWith(`${path}.`)) continue
    const [index, property, ...rest] = key.slice(path.length + 1).split('.')
    if (!index || !/^\d+$/.test(index) || !property || rest.length) continue
    const row = rows.get(Number(index)) ?? {}
    row[property] = field.value
    rows.set(Number(index), row)
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row)
    .filter(row => typeof row.key === 'string' && typeof row.weight === 'number' && typeof row.kind === 'string') as AllocationGroup[]
}

export function allocationLayer(value: unknown): AllocationLayer | undefined {
  if (!value || typeof value !== 'object') return undefined
  const layer = value as Partial<AllocationLayer>
  return typeof layer.name === 'string' && typeof layer.used === 'number' && Number.isFinite(layer.used)
    && typeof layer.free === 'number' && Number.isFinite(layer.free) ? layer as AllocationLayer : undefined
}
