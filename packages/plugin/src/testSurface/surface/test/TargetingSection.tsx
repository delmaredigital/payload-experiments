'use client'
import { Button } from '../../../ui/Button.js'
import { useId, useState } from 'react'
import { ChipsInput } from '../../../ui/ChipsInput.js'
import { AUDIENCE_COPY } from '../../copy/audience.js'
import type { SectionProps } from '../contracts.js'
import type { TargetingRule } from '../../../types/contracts.js'
import type { TargetingOp } from '../../../targeting/ops.js'
import { coerceValue, emptyListHint, humaniseAttribute, opLabel, opsFor, readListValue, readTargetingRules, valueInput } from '../../targeting/targeting.model.js'
import { TEST_PAGE as C, NUMBER_COMPARISONS } from '../../copy/testPage.js'
import { CheckboxList, FieldErrors, reasonFor, save, SelectEdit, TextEdit } from './fields.js'
import { Section } from './Section.js'

export function TargetingSection({ test, surface }: SectionProps) {
  const id = useId()
  const doc = test.doc!
  const rules = readTargetingRules(doc.targeting ?? [])
  // Removing a row invalidates index-based drafts, including unfinished chip text.
  const [rowsRevision, setRowsRevision] = useState(0)
  const reason = reasonFor(test, 'targeting')
  const update = (transform: (current: TargetingRule[]) => TargetingRule[]) => save(test, 'targeting', () => ({ targeting: transform(readTargetingRules(test.doc!.targeting ?? [])) }))
  // Page block tests are scoped by their page; path rules belong to setting and flag tests (ruling Nov 3).
  const blockPath = (key: string) => test.doc!.kind === 'block' && key === 'path'
  const keys = Object.keys(surface.attributeKeys).filter(key => !blockPath(key))
  return <Section surface={surface} test={test} sectionId="who"><p>{rules.length ? C.rulesSummary : C.everyone}</p>
    {rules.map((rule, index) => {
      const remove = () => { setRowsRevision(revision => revision + 1); update(current => current.filter((_, i) => i !== index)) }
      if (blockPath(rule.attribute)) return <div className="xp-targeting-row" key={`${rowsRevision}-${index}`}><p className="xp-ui-help">{C.blockPathRule}</p>
        {!reason ? <div className="xp-ui-button-group"><Button variant="link" size="sm" onClick={remove}>{C.removeRule}</Button></div> : null}</div>
      const attribute = surface.attributeKeys[rule.attribute]
      const input = valueInput(attribute, rule.op)
      const setRule = (partial: Partial<TargetingRule>) => update(current => current.map((row, i) => i === index ? { ...row, ...partial } : row))
      const hint = emptyListHint(rule.op, rule.value)
      const changeValue = (raw: unknown) => {
        const current = test.doc!.targeting?.[index]
        const schema = current && surface.attributeKeys[current.attribute]
        if (!current || !schema) return
        const value = coerceValue(schema.type, current.op, raw)
        if (value !== null) setRule({ value })
      }
      return <div className="xp-targeting-row" key={`${rowsRevision}-${index}`}>
        <SelectEdit label={C.attribute} reason={reason} value={rule.attribute}
          options={[...keys, ...(!attribute ? [rule.attribute] : [])].map(key => ({ value: key, label: humaniseAttribute(key) }))}
          onCommit={value => { const key = String(value); const type = surface.attributeKeys[key]!.type; setRule({ attribute: key, op: 'eq', value: type === 'boolean' ? false : type === 'number' ? 0 : '' }) }} />
        <SelectEdit label={C.comparison} reason={reason} value={rule.op} options={opsFor(attribute?.type).map(op => ({ value: op, label: attribute?.type === 'number' ? NUMBER_COMPARISONS[op as keyof typeof NUMBER_COMPARISONS] : opLabel(attribute!.type, op) }))}
          onCommit={value => { const op = value as TargetingOp; const current = readTargetingRules(test.doc!.targeting ?? [])[index]; setRule({ op, value: coerceValue(attribute!.type, op, current?.value) ?? '' }) }} />
        {input.kind === 'multiselect' ? <CheckboxList label={C.value} reason={reason} value={readListValue(rule.value)}
          options={input.options ?? []} onToggle={(value, checked) => {
            const values = readListValue(test.doc!.targeting?.[index]?.value)
            changeValue(checked ? [...new Set([...values, value])] : values.filter(saved => saved !== value))
          }} />
          : input.kind === 'chips' ? <ChipsInput key={`${rule.attribute}-${rule.op}`} id={`${id}-${index}-value`} label={C.value} value={readListValue(rule.value)}
          disabled={Boolean(reason)} description={reason ?? AUDIENCE_COPY.listDescription} placeholder={AUDIENCE_COPY.listPlaceholder} onChange={changeValue} />
          : input.kind === 'select' ? <SelectEdit label={C.value} reason={reason} value={String(rule.value)} options={input.options ?? []} onCommit={changeValue} />
          : input.kind === 'boolean' ? <SelectEdit label={C.value} reason={reason} value={String(rule.value)} options={[{ value: 'true', label: C.yes }, { value: 'false', label: C.no }]} onCommit={changeValue} />
          : <TextEdit label={C.value} reason={reason} value={Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value)} type={input.kind === 'number' ? 'number' : 'text'} onCommit={changeValue} />}
        {hint ? <p>{hint}</p> : null}<FieldErrors test={test} path={`targeting.${index}`} />
        {!reason ? <div className="xp-ui-button-group"><Button variant="link" size="sm" onClick={remove}>{C.removeRule}</Button></div> : null}
      </div>
    })}
    {!reason ? <div className="xp-ui-button-group"><Button disabled={!keys.length} onClick={() => {
      const attribute = keys[0]!
      const type = surface.attributeKeys[attribute]!.type
      update(current => [...current, { attribute, op: 'eq', value: type === 'boolean' ? false : type === 'number' ? 0 : '' }])
    }}>{C.addRule}</Button></div> : null}<FieldErrors test={test} path="targeting" />
  </Section>
}
