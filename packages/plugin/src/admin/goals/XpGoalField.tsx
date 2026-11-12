'use client'
import { Button, FieldDescription, FieldError, FieldLabel, SelectInput, useAuth, useConfig, useField } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import { useId, type ComponentProps, type KeyboardEvent } from 'react'
import { useClickGoalPicker } from '../../goals/picker/useClickGoalPicker.js'
import { clickGoalOptions } from '../../goals/picker/clickGoalPicker.model.js'
import { CLICK_GOAL_COPY as C } from '../../goals/picker/copy.js'
import '../theme.css'
import './xpGoalField.css'

export function XpGoalField({ path, field, readOnly }: TextFieldClientProps) {
  const { value, setValue, showError } = useField<string>({ path })
  const { permissions } = useAuth()
  const { config } = useConfig()
  const access: { update?: boolean } | undefined = permissions?.collections?.['xp-experiments']
  const locked = Boolean(readOnly || field.admin?.readOnly)
  const picker = useClickGoalPicker(config.routes.api, { enabled: access?.update === true && !locked, onSelect: setValue })
  const { options, missing } = clickGoalOptions(picker.status, picker.goals, value ?? '')
  const readonly = locked || picker.status === 'not-manager'
  const id = useId(), namePath = `${id}-name`, slugPath = `${id}-slug`
  const stopEnter = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation() } }
  return <div className="field-type xp-goal-field">
    {readonly ? <div><FieldLabel path={path} label={C.label} required={field.required} />
      <p>{value || C.none}</p></div> : <div className="xp-goal-field__row">
      <SelectInput name={path} path={path} className="xp-goal-field__select"
        value={value ?? ''} options={options} label={C.label} required={field.required}
        readOnly={picker.status !== 'ready'} isClearable={false} placeholder={C.none} showError={showError}
        onChange={option => { if (picker.status === 'ready' && option && !Array.isArray(option)) setValue(String(option.value)) }} />
      {picker.canManage && !picker.panel.open ? <Button type="button" margin={false} buttonStyle="secondary" onClick={picker.open}>{C.newGoal}</Button> : null}
    </div>}
    {readonly ? <FieldError path={path} showError={showError} /> : null}
    <FieldDescription path={path} description={field.admin?.description as ComponentProps<typeof FieldDescription>['description']} />
    {!readonly && picker.status === 'error' ? <div><p>{C.loadError}</p>
      <Button type="button" margin={false} buttonStyle="secondary" onClick={picker.retry}>{C.retry}</Button></div> : null}
    {missing && !readonly ? <p role="status">{C.undefinedKey}</p> : null}
    {picker.canManage && !locked ? <>
      {picker.panel.open ? <section className="xp-goal-field__panel" aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`}>{C.title}</h3>
        <div className="field-type text"><FieldLabel path={namePath} label={C.name} />
          <input id={`field-${namePath}`} value={picker.panel.name} disabled={picker.panel.pending} onKeyDown={stopEnter}
            onChange={event => picker.setName(event.currentTarget.value)} /></div>
        <details open={picker.panel.advanced} onToggle={event => picker.setAdvanced(event.currentTarget.open)}><summary>{C.advanced}</summary>
          <div className="field-type text"><FieldLabel path={slugPath} label={C.slug} />
            <input id={`field-${slugPath}`} value={picker.panel.slug} disabled={picker.panel.pending} onKeyDown={stopEnter}
              aria-invalid={Boolean(picker.panel.errors.slug) || undefined} aria-describedby={picker.panel.errors.slug ? `${id}-slug-error` : undefined}
              onChange={event => picker.setSlug(event.currentTarget.value)} />
            {picker.panel.errors.slug ? <p id={`${id}-slug-error`} role="alert">{picker.panel.errors.slug}</p> : null}</div>
        </details>
        {picker.panel.errors.general ? <p role="alert">{picker.panel.errors.general}</p> : null}
        <div className="xp-goal-field__actions">
          <Button type="button" margin={false} buttonStyle="primary" disabled={picker.panel.pending || !picker.panel.name.trim()} onClick={() => void picker.create()}>{C.createGoal}</Button>
          <Button type="button" margin={false} buttonStyle="secondary" disabled={picker.panel.pending} onClick={picker.cancel}>{C.cancel}</Button>
        </div>
      </section> : null}
    </> : null}
  </div>
}
