'use client'
import { useId, type KeyboardEvent } from 'react'
import type { CustomField } from '@puckeditor/core'
import { useClickGoalPicker } from '../../goals/picker/useClickGoalPicker.js'
import { clickGoalOptions } from '../../goals/picker/clickGoalPicker.model.js'
import { CLICK_GOAL_COPY as C } from '../../goals/picker/copy.js'
import { TextInput, Select } from '../../ui/Inputs.js'
import { Button } from '../../ui/Button.js'
import { resolvePuckRoutes, type PuckRoutes } from '../routes.js'
import './editor.css'

function XpGoalPuckEditor({ value, onChange, api, readOnly }: { value: string; onChange: (value: string) => void; api: string; readOnly?: boolean }) {
  const picker = useClickGoalPicker(api, { enabled: !readOnly, onSelect: onChange })
  const { options, missing } = clickGoalOptions(picker.status, picker.goals, value ?? '')
  const readonly = readOnly || picker.status === 'not-manager'
  const id = useId()
  const stopEnter = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation() } }
  return <div className="xp-slot-root xp-puck-field">
    {readonly ? <div className="xp-ui-field"><span>{C.label}</span><p>{value || C.none}</p></div> : <div className="xp-ui-inline-row">
      <Select id={`${id}-picker`} label={C.label} value={value ?? ''} disabled={picker.status !== 'ready'}
        onChange={event => onChange(event.currentTarget.value)}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
      {picker.canManage && !picker.panel.open ? <Button type="button" onClick={picker.open}>{C.newGoal}</Button> : null}
    </div>}
    {!readonly && picker.status === 'error' ? <div><p className="xp-ui-help">{C.loadError}</p><Button type="button" onClick={picker.retry}>{C.retry}</Button></div> : null}
    {missing && !readonly ? <p className="xp-ui-help" role="status">{C.undefinedKey}</p> : null}
    {picker.canManage && !readOnly ? <>
      {picker.panel.open ? <section className="xp-ui-subpanel" aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`}>{C.title}</h3>
        <TextInput id={`${id}-name`} label={C.name} value={picker.panel.name} disabled={picker.panel.pending} onKeyDown={stopEnter}
          onChange={event => picker.setName(event.currentTarget.value)} />
        <details open={picker.panel.advanced} onToggle={event => picker.setAdvanced(event.currentTarget.open)}><summary>{C.advanced}</summary>
          <TextInput id={`${id}-slug`} label={C.slug} value={picker.panel.slug} disabled={picker.panel.pending} onKeyDown={stopEnter}
            error={picker.panel.errors.slug} onChange={event => picker.setSlug(event.currentTarget.value)} />
        </details>
        {picker.panel.errors.general ? <p className="xp-ui-error" role="alert">{picker.panel.errors.general}</p> : null}
        <div className="xp-ui-button-group">
          <Button type="button" variant="primary" disabled={picker.panel.pending || !picker.panel.name.trim()} onClick={() => void picker.create()}>{C.createGoal}</Button>
          <Button type="button" disabled={picker.panel.pending} onClick={picker.cancel}>{C.cancel}</Button>
        </div>
      </section> : null}
    </> : null}
  </div>
}

/** Editor config only. The render config keeps xpGoalPuckField() from /puck. */
export function xpGoalPuckEditorField(options?: { routes?: PuckRoutes }): CustomField<string> {
  const routes = resolvePuckRoutes(options?.routes)
  return { type: 'custom', label: C.label,
    render: ({ value, onChange, readOnly }) => <XpGoalPuckEditor value={value} onChange={onChange} api={routes.api} readOnly={readOnly} /> }
}
