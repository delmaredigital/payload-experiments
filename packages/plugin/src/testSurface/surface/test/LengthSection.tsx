'use client'
import { Button } from '../../../ui/Button.js'
import type { SectionProps } from '../contracts.js'
import { TEST_PAGE as C, suggestedWeeks, weeksHint } from '../../copy/testPage.js'
import { durationSuggestion } from './testPage.model.js'
import { FieldErrors, positiveInteger, reasonFor, save, TextEdit } from './fields.js'
import { Section } from './Section.js'

export function LengthSection({ test, surface }: SectionProps) {
  const doc = test.doc!
  const reason = reasonFor(test, 'analysis')
  const suggestion = durationSuggestion(test.preflight, doc.analysis?.plannedDurationDays)
  const required = ['manual', 'viewport'].includes(doc.exposurePolicy)
  const change = (field: 'reachPerDay' | 'plannedDurationDays', raw: string) => save(test, 'analysis', () => ({ analysis: { ...test.doc!.analysis, [field]: raw.trim() ? Number(raw) : null } }))
  return <Section surface={surface} test={test} sectionId="length">
    <div className="xp-field-grid"><div><TextEdit label={required ? `${C.reach} ${C.required}` : C.reach} value={doc.analysis?.reachPerDay ?? ''} type="number" min={1} reason={reason}
      required={required} onCommit={value => change('reachPerDay', value)} />
    <p className="xp-ui-help">{C.reachHelp}</p><FieldErrors test={test} path="analysis.reachPerDay" /></div>
    <div><TextEdit label={C.duration} value={doc.analysis?.plannedDurationDays ?? 28} type="number" min={1} reason={reason} isValid={positiveInteger} onCommit={value => change('plannedDurationDays', value)} help={weeksHint(doc.analysis?.plannedDurationDays ?? 28)} /><FieldErrors test={test} path="analysis.plannedDurationDays" /></div></div>
    {suggestion ? <div className="xp-duration-suggestion xp-ui-button-group"><p>{suggestedWeeks(suggestion.weeks)}</p>
      {!reason ? <Button onClick={() => save(test, 'analysis', () => ({ analysis: { ...test.doc!.analysis,
        plannedDurationDays: suggestion.plannedDurationDays, sequentialTuningParameter: suggestion.sequentialTuningParameter,
      } }))}>{C.apply}</Button> : null}{!suggestion.feasible ? <p>{C.infeasible}</p> : null}</div>
      : !test.preflight?.estimate ? <p>{doc.analysis?.reachPerDay == null ? C.noSuggestion : C.chooseGoalSuggestion}</p> : null}
    {test.errors.analysis ? <p role="alert">{test.errors.analysis}</p> : null}
  </Section>
}
