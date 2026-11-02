'use client'
import type { SectionProps } from '../contracts.js'
import { TEST_PAGE as C, suggestedWeeks, weeksHint } from '../../copy/testPage.js'
import { durationSuggestion } from './testPage.model.js'
import { FieldErrors, reasonFor, save, TextEdit } from './fields.js'
import { Section } from './Section.js'

export function LengthSection({ test }: SectionProps) {
  const doc = test.doc!
  const reason = reasonFor(test, 'analysis')
  const suggestion = durationSuggestion(test.preflight, doc.analysis?.plannedDurationDays)
  const change = (field: 'reachPerDay' | 'plannedDurationDays', raw: string) => save(test, 'analysis', () => ({ analysis: { ...test.doc!.analysis, [field]: raw.trim() ? Number(raw) : null } }))
  return <Section test={test} sectionId="length">
    <TextEdit label={C.reach} value={doc.analysis?.reachPerDay ?? ''} type="number" min={1} reason={reason}
      required={['manual', 'viewport'].includes(doc.exposurePolicy)} onCommit={value => change('reachPerDay', value)} />
    <p>{C.reachHelp}</p><FieldErrors test={test} path="analysis.reachPerDay" />
    {suggestion ? <div className="xp-duration-suggestion"><p>{suggestedWeeks(suggestion.weeks)}</p>
      {!reason ? <button type="button" onClick={() => save(test, 'analysis', () => ({ analysis: { ...test.doc!.analysis,
        plannedDurationDays: suggestion.plannedDurationDays, sequentialTuningParameter: suggestion.sequentialTuningParameter,
      } }))}>{C.apply}</button> : null}{!suggestion.feasible ? <p>{C.infeasible}</p> : null}</div>
      : !test.preflight?.estimate ? <p>{C.noSuggestion}</p> : null}
    <TextEdit label={C.duration} value={doc.analysis?.plannedDurationDays ?? 28} type="number" min={1} reason={reason} onCommit={value => change('plannedDurationDays', value)} />
    <p>{weeksHint(doc.analysis?.plannedDurationDays ?? 28)}</p><FieldErrors test={test} path="analysis.plannedDurationDays" />
    {test.errors.analysis ? <p role="alert">{test.errors.analysis}</p> : null}
  </Section>
}
