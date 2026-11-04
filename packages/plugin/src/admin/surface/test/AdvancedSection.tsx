'use client'
import type { SectionProps } from '../contracts.js'
import type { TestDocument } from '../testDocument.model.js'
import type { ExposurePolicy } from '../../../types/contracts.js'
import { ADVANCED_COPY as C } from '../../copy/advanced.js'
import { exposureOptions } from './testPage.model.js'
import { FieldErrors, positiveInteger, ReadOnly, reasonFor, save, SelectEdit, TextEdit } from './fields.js'
import { Section } from './Section.js'

type Analysis = NonNullable<TestDocument['analysis']>
const readOnlyFields = ['layer', 'slug', 'kind', 'unitType'] as const
export function AdvancedSection({ test, surface }: SectionProps) {
  const doc = test.doc!
  const reason = reasonFor(test, 'analysis')
  const change = <K extends keyof Analysis>(field: K, value: Analysis[K]) => save(test, 'analysis', () => ({ analysis: { ...test.doc!.analysis, [field]: value } }))
  const numbers = [
    ['minExposuresPerArm', 200, 1], ['attributionWindowHours', '', 1], ['sequentialTuningParameter', '', 0],
  ] as const
  return <Section test={test} sectionId="advanced">
    <SelectEdit label={C.exposurePolicy.label} value={doc.exposurePolicy} reason={reasonFor(test, 'exposurePolicy')}
      options={exposureOptions(doc.kind).map(value => ({ value, label: C.policies[value] }))}
      onCommit={value => save(test, 'exposurePolicy', () => ({ exposurePolicy: value as ExposurePolicy }))} />
    <p>{C.exposurePolicy.help}</p><FieldErrors test={test} path="exposurePolicy" />
    {surface.isAdmin ? <><SelectEdit label={C.method.label} value={doc.analysis?.method ?? 'sequential'} reason={reason}
      options={[{ value: 'sequential', label: C.sequential }, { value: 'bayesian', label: C.bayesian }]}
      onCommit={value => change('method', value as Analysis['method'])} /><p>{C.method.help}</p><FieldErrors test={test} path="analysis.method" /></> : null}
    <SelectEdit label={C.cuped.label} value={doc.analysis?.cuped ?? 'auto'} reason={reason}
      options={[{ value: 'auto', label: C.auto }, { value: 'off', label: C.off }]} onCommit={value => change('cuped', value as Analysis['cuped'])} />
    <p>{C.cuped.help}</p><FieldErrors test={test} path="analysis.cuped" />
    {numbers.map(([field, fallback, min]) => <div key={field}><TextEdit label={C[field].label} value={doc.analysis?.[field] ?? fallback} placeholder={field === 'attributionWindowHours' ? C.inheritedWindow : field === 'sequentialTuningParameter' ? C.automaticTuning : undefined} type="number" min={min} reason={reason}
      validate={field === 'minExposuresPerArm' ? positiveInteger : undefined} onCommit={raw => change(field, raw.trim() ? Number(raw) : null)} /><p>{C[field].help}</p><FieldErrors test={test} path={`analysis.${field}`} /></div>)}
    {readOnlyFields.map(field => <div key={field}>
      <ReadOnly label={C[field].label} value={typeof doc[field] === 'string' || typeof doc[field] === 'number' ? String(doc[field]) : C.none} reason={reasonFor(test, field)} />
      <p>{C[field].help}</p></div>)}
  </Section>
}
