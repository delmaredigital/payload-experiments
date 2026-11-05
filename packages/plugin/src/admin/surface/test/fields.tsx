'use client'
import { useEffect, useId, useState } from 'react'
import { TextInput, NumberInput, Textarea, Select, SearchInput, Checkbox, CheckboxList as UICheckboxList } from '../../../ui/Inputs.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import type { ReactNode } from 'react'
import { EDITABLE_BY_STATUS } from '../../../collections/experiments/editability.js'
import { lockedReason } from '../../lockedNotice.model.js'
import type { SectionProps, TestDocApi } from '../contracts.js'
import type { EditableField } from '../../../types/admin.js'
import type { TestDocumentPatch } from '../testDocument.model.js'

export function reasonFor(test: TestDocApi, field: string): string | null {
  return test.doc ? lockedReason(test.doc.status, field, EDITABLE_BY_STATUS) : null
}
export function save(test: TestDocApi, field: EditableField, patch: () => TestDocumentPatch) {
  if (!test.doc || reasonFor(test, field)) return
  test.stage(patch())
  void test.commit()
}
export function FieldErrors({ test, path }: { test: TestDocApi; path: string }) {
  return <>{Object.entries(test.errors).filter(([key]) => key === path || key.startsWith(`${path}.`))
    .map(([key, message]) => <p className="xp-field-error" role="alert" key={key}>{message}</p>)}</>
}
export function ReadOnly({ label, value, reason, labelAction }: { label: string; value: ReactNode; reason: string | null; labelAction?: ReactNode }) {
  return <div className="xp-read-only" title={reason ?? undefined}><div className="xp-ui-field-label"><strong>{label}</strong>{labelAction}</div><p>{value}</p>{reason ? <small>{reason}</small> : null}</div>
}
/** Local typing is intentionally separate from staging: build the current group on commit. */
export function TextEdit({ label, value, onCommit, reason, multiline, placeholder, type = 'text', min, max, required, onDraft, isValid, invalidMessage, hideLabel = false, disabled = false, help }: {
  label: string; value: string | number; onCommit: (value: string) => void; reason?: string | null
  onDraft?: (value: string) => void; multiline?: boolean; placeholder?: string; type?: 'text' | 'number'; min?: number; max?: number; required?: boolean
  isValid?: (value: string) => boolean; invalidMessage?: string; hideLabel?: boolean; disabled?: boolean; help?: string
}) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    if (draft === String(value)) return
    // Named isValid, not validate: Payload 4's Local API has a validate method, which the access gate flags.
    if (isValid && !isValid(draft)) {
      setError(draft.trim() ? invalidMessage ?? null : null)
      setDraft(String(value))
      onDraft?.(String(value))
      return
    }
    onCommit(draft)
  }
  if (reason && !disabled) return <ReadOnly label={label} value={value === '' && placeholder ? placeholder : value} reason={reason} />
  const Input = multiline ? Textarea : type === 'number' ? NumberInput : TextInput
  return <div className={hideLabel ? 'xp-grid-field' : undefined} title={reason ?? undefined}><Input id={id} label={label} aria-label={label} value={draft}
    disabled={disabled} placeholder={placeholder} min={min} max={max} required={required} help={help} error={error ?? undefined}
    onChange={e => { setError(null); setDraft(e.target.value); onDraft?.(e.target.value) }} onBlur={commit}
    onKeyDown={e => { if (!multiline && e.key === 'Enter') e.currentTarget.blur() }} /></div>

}
export const positiveInteger = (raw: string) => raw.trim() !== '' && Number.isInteger(Number(raw)) && Number(raw) > 0
export type OptionGroup = { label?: string; options: readonly { label: string; value: string }[] }
export function SelectEdit({ label, value, options, groups, reason, onCommit, readOnlyValue, labelAction }: {
  label: string; value: string; options: readonly { label: string; value: string }[]; reason?: string | null
  onCommit: (value: string) => void; readOnlyValue?: string; labelAction?: ReactNode; groups?: readonly OptionGroup[]
}) {
  const id = useId()
  if (reason) {
    return <ReadOnly label={label} reason={reason} labelAction={labelAction} value={readOnlyValue ?? options.find(o => o.value === value)?.label ?? value} />
  }
  return <Select id={id} label={label} labelAction={labelAction} value={value} onChange={e => onCommit(e.target.value)}>
    {groups ? groups.map((group, index) => group.label
      ? <optgroup key={index} label={group.label}>{group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>
      : group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>))
      : options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </Select>
}
export function CheckboxList({ label, value, options, groups, reason, onToggle, readOnlyValue, searchable = false }: {
  label: string; value: string[]; options: readonly { label: string; value: string }[]; reason?: string | null
  onToggle: (value: string, checked: boolean) => void; readOnlyValue?: string; searchable?: boolean; groups?: readonly OptionGroup[]
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const visible = searchable ? options.filter(option => value.includes(option.value) || option.label.toLowerCase().includes(query.toLowerCase())) : options
  if (reason) return <ReadOnly label={label} reason={reason} value={readOnlyValue ?? value.map(v => options.find(o => o.value === v)?.label ?? v).join(', ')} />
  return <UICheckboxList id={id} label={label} value={value} options={groups ? [] : visible} onChange={next => {
    const changed = options.find(option => next.includes(option.value) !== value.includes(option.value))
    if (changed) onToggle(changed.value, next.includes(changed.value))
  }}>{searchable ? <SearchInput id={`${id}-search`} label={C.searchGoals} value={query} onChange={event => setQuery(event.target.value)} /> : null}{groups ? groups.map((group, index) => {
    const items = group.options.filter(option => visible.some(item => item.value === option.value))
    return items.length ? <div key={index}>{group.label ? <h3>{group.label}</h3> : null}<ul>{items.map(option => <li key={option.value}><Checkbox
      id={`${id}-${index}-${option.value}`} label={option.label} checked={value.includes(option.value)} onChange={event => onToggle(option.value, event.target.checked)} /></li>)}</ul></div> : null
  }) : null}</UICheckboxList>
}
export function TestName({ test }: SectionProps) {
  return <><TextEdit label={C.name} value={test.doc?.name ?? ''} reason={reasonFor(test, 'name')}
    onCommit={value => save(test, 'name', () => ({ name: value }))} /><FieldErrors test={test} path="name" /></>
}
export function Hypothesis({ test }: SectionProps) {
  return <><TextEdit label={C.hypothesis} value={test.doc?.hypothesis ?? ''} multiline
    placeholder={C.hypothesisPlaceholder} reason={reasonFor(test, 'hypothesis')}
    onCommit={value => save(test, 'hypothesis', () => ({ hypothesis: value }))} /><FieldErrors test={test} path="hypothesis" /></>
}
