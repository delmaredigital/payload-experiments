'use client'

import { useRef, useState } from 'react'
import './ui.css'

export interface ChipsInputProps {
  value: string[]
  onChange: (value: string[]) => void
  label: string
  description?: string
  help?: string
  error?: string
  placeholder?: string
  disabled?: boolean
  id: string
}

export function ChipsInput({ value, onChange, label, description, help = description, error, placeholder, disabled = false, id }: ChipsInputProps) {
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const commit = (text: string) => {
    if (disabled) return
    const next = [...new Set([...value, ...text.split(',')].map(item => item.trim()).filter(Boolean))]
    if (next.length !== value.length || next.some((item, index) => item !== value[index])) onChange(next)
    setDraft('')
  }
  const remove = (index: number) => {
    if (disabled) return
    onChange(value.filter((_, i) => i !== index))
    input.current?.focus()
  }
  return <div className="xp-ui-chips" role="group" aria-labelledby={`${id}-label`} aria-disabled={disabled}>
    <label id={`${id}-label`} htmlFor={id}>{label}</label>
    <div className={`xp-ui-chips-control${error ? ' xp-ui-chips-control--invalid' : ''}`}>
      {value.map((item, index) => <span className="xp-ui-chips-item" key={item}>
        <span>{item}</span>
        <button type="button" disabled={disabled} aria-label={`Remove ${item}`} onClick={() => remove(index)}>{'×'}</button>
      </span>)}
      <input ref={input} id={id} type="text" value={draft} disabled={disabled} placeholder={placeholder}
        aria-invalid={Boolean(error) || undefined} aria-describedby={[help ? `${id}-description` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined}
        onChange={event => setDraft(event.target.value)}
        onBlur={() => { if (draft.trim()) commit(draft) }}
        onKeyDown={event => {
          if (disabled || event.nativeEvent.isComposing) return
          if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); commit(draft) }
          else if (event.key === 'Tab' && draft.trim()) commit(draft)
          else if (event.key === 'Backspace' && !draft && value.length) { event.preventDefault(); remove(value.length - 1) }
        }}
        onPaste={event => {
          if (disabled) return
          const pasted = event.clipboardData.getData('text')
          if (!pasted.includes(',')) return
          event.preventDefault()
          const start = event.currentTarget.selectionStart ?? draft.length
          const end = event.currentTarget.selectionEnd ?? start
          commit(draft.slice(0, start) + pasted + draft.slice(end))
        }} />
    </div>
    {help ? <p id={`${id}-description`}>{help}</p> : null}
    {error ? <p className="xp-ui-error" id={`${id}-error`} role="alert">{error}</p> : null}
  </div>
}
