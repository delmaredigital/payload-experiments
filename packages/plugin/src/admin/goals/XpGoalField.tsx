'use client'
import { Button, FieldError, FieldLabel, TextInput, useAuth, useConfig, useField } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import { useId, type ChangeEvent, type KeyboardEvent } from 'react'
import { useClickGoalPicker } from '../../goals/picker/useClickGoalPicker.js'
import { CLICK_GOAL_COPY as C } from '../../goals/picker/copy.js'

export function XpGoalField({ path, field, readOnly }: TextFieldClientProps) {
  const { value, setValue, showError } = useField<string>({ path })
  const { permissions } = useAuth()
  const { config } = useConfig()
  const access: { update?: boolean } | undefined = permissions?.collections?.['xp-experiments']
  const locked = Boolean(readOnly || field.admin?.readOnly)
  const picker = useClickGoalPicker(config.routes.api, { enabled: access?.update === true, onSelect: setValue })
  const id = useId(), namePath = `${id}-name`, slugPath = `${id}-slug`
  const stopEnter = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation() } }
  return <div>
    <TextInput path={path} label={field.label ?? C.label} description={field.admin?.description}
      required={field.required} readOnly={locked} value={value ?? ''} showError={showError}
      Error={<FieldError path={path} showError={showError} />}
      onChange={(event: ChangeEvent<HTMLInputElement>) => { if (!locked) setValue(event.currentTarget.value) }} />
    {picker.canManage && !locked ? <>
      <label htmlFor={`${id}-picker`}>{C.choose}</label>
      <select id={`${id}-picker`} value={picker.goals.some(goal => goal.slug === value) ? value : ''}
        onChange={event => { if (event.currentTarget.value) setValue(event.currentTarget.value) }}>
        <option value="">{C.choose}</option>{picker.goals.map(goal => <option key={goal.id} value={goal.slug}>{goal.name}</option>)}
      </select>
      {picker.undefinedKey(value ?? '') ? <p role="status">{C.undefinedKey}</p> : null}
      {!picker.panel.open ? <Button type="button" onClick={picker.open}>{C.newGoal}</Button> : <section aria-labelledby={`${id}-title`}>
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
        <Button type="button" disabled={picker.panel.pending || !picker.panel.name.trim()} onClick={() => void picker.create()}>{C.createGoal}</Button>
        <Button type="button" disabled={picker.panel.pending} onClick={picker.cancel}>{C.cancel}</Button>
      </section>}
    </> : null}
  </div>
}
