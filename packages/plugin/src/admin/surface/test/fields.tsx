'use client'
import { useEffect, useId, useState } from 'react'
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
export function ReadOnly({ label, value, reason }: { label: string; value: ReactNode; reason: string | null }) {
  return <div className="xp-read-only" title={reason ?? undefined}><strong>{label}</strong><p>{value}</p>{reason ? <small>{reason}</small> : null}</div>
}
/** Local typing is intentionally separate from staging: build the current group on commit. */
export function TextEdit({ label, value, onCommit, reason, multiline, placeholder, type = 'text', min, max, required, onDraft }: {
  label: string; value: string | number; onCommit: (value: string) => void; reason?: string | null
  onDraft?: (value: string) => void; multiline?: boolean; placeholder?: string; type?: 'text' | 'number'; min?: number; max?: number; required?: boolean
}) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => { if (draft !== String(value)) onCommit(draft) }
  if (reason) return <ReadOnly label={label} value={value === '' && placeholder ? placeholder : value} reason={reason} />
  return <label className="xp-field" htmlFor={id}><span>{label}</span>{multiline
    ? <textarea id={id} value={draft} placeholder={placeholder} onChange={e => { setDraft(e.target.value); onDraft?.(e.target.value) }} onBlur={commit} />
    : <input id={id} type={type} value={draft} min={min} max={max} required={required} placeholder={placeholder}
      onChange={e => { setDraft(e.target.value); onDraft?.(e.target.value) }} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />}</label>
}
export function SelectEdit({ label, value, options, reason, onCommit, multiple = false }: {
  label: string; value: string | string[]; options: readonly { label: string; value: string }[]; reason?: string | null
  onCommit: (value: string | string[]) => void; multiple?: boolean
}) {
  const id = useId()
  if (reason) {
    const values = Array.isArray(value) ? value : [value]
    return <ReadOnly label={label} reason={reason} value={values.map(v => options.find(o => o.value === v)?.label ?? v).join(', ')} />
  }
  return <label className="xp-field" htmlFor={id}><span>{label}</span><select id={id} multiple={multiple} value={value}
    onChange={e => onCommit(multiple ? Array.from(e.target.selectedOptions, option => option.value) : e.target.value)}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>
}
export function Hypothesis({ test }: SectionProps) {
  return <><TextEdit label={C.hypothesis} value={test.doc?.hypothesis ?? ''} multiline
    placeholder={C.hypothesisPlaceholder} reason={reasonFor(test, 'hypothesis')}
    onCommit={value => save(test, 'hypothesis', () => ({ hypothesis: value }))} /><FieldErrors test={test} path="hypothesis" /></>
}
