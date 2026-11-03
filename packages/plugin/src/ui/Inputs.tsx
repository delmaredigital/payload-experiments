'use client'
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react'
import './ui.css'
export interface FieldProps { id: string; label: string; help?: string; error?: string }
function described(props: FieldProps, extra?: string) {
  return [extra, props.help ? `${props.id}-help` : '', props.error ? `${props.id}-error` : ''].filter(Boolean).join(' ') || undefined
}
function Field({ id, label, help, error, children }: FieldProps & { children: ReactNode }) {
  return <div className="xp-ui-field"><label htmlFor={id}>{label}</label>{children}
    {help ? <p className="xp-ui-help" id={`${id}-help`}>{help}</p> : null}
    {error ? <p className="xp-ui-error" id={`${id}-error`} role="alert">{error}</p> : null}</div>
}
export type TextInputProps = FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>
export function TextInput({ label, help, error, className = '', ...props }: TextInputProps) {
  const field = { id: props.id, label, help, error }
  return <Field {...field}><input {...props} className={`xp-ui-input ${className}`} aria-invalid={Boolean(error) || undefined}
    aria-describedby={described(field, props['aria-describedby'])} /></Field>
}
export function NumberInput(props: TextInputProps) { return <TextInput {...props} type="number" className={`xp-ui-input--number ${props.className ?? ''}`} /> }
export function SearchInput(props: TextInputProps) { return <TextInput {...props} type="search" /> }
export type SelectProps = FieldProps & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'>
export function Select({ label, help, error, className = '', ...props }: SelectProps) {
  const field = { id: props.id, label, help, error }
  return <Field {...field}><select {...props} className={`xp-ui-input xp-ui-select ${className}`} aria-invalid={Boolean(error) || undefined}
    aria-describedby={described(field, props['aria-describedby'])} /></Field>
}
export function Toggle({ label, help, error, className = '', ...props }: Omit<TextInputProps, 'type'>) {
  const field = { id: props.id, label, help, error }
  return <Field {...field}><input {...props} type="checkbox" role="switch" className={`xp-ui-toggle ${className}`}
    aria-invalid={Boolean(error) || undefined} aria-describedby={described(field, props['aria-describedby'])}
    onKeyDown={event => {
      props.onKeyDown?.(event)
      if (event.key === ' ' && !event.defaultPrevented && !props.disabled) { event.preventDefault(); event.currentTarget.click() }
    }} /></Field>
}

export type TextareaProps = FieldProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>
export function Textarea({ label, help, error, className = '', ...props }: TextareaProps) {
  const field = { id: props.id, label, help, error }
  return <Field {...field}><textarea {...props} className={`xp-ui-input xp-ui-textarea ${className}`}
    aria-invalid={Boolean(error) || undefined} aria-describedby={described(field, props['aria-describedby'])} /></Field>
}
export function Checkbox({ label, help, error, className = '', ...props }: Omit<TextInputProps, 'type'>) {
  const field = { id: props.id, label, help, error }
  return <div className="xp-ui-field"><label className="xp-ui-checkbox-label" htmlFor={props.id}>
    <input {...props} type="checkbox" className={`xp-ui-checkbox ${className}`} aria-invalid={Boolean(error) || props['aria-invalid'] || undefined}
      aria-describedby={described(field, props['aria-describedby'])} />{label}</label>
    {help ? <p className="xp-ui-help" id={`${props.id}-help`}>{help}</p> : null}
    {error ? <p className="xp-ui-error" id={`${props.id}-error`} role="alert">{error}</p> : null}
  </div>
}
export interface CheckboxListProps extends FieldProps {
  value: readonly string[]
  options: readonly { value: string; label: string; disabled?: boolean }[]
  onChange: (value: string[]) => void
  disabled?: boolean
  'aria-describedby'?: string
}
export function CheckboxList({ value, options, onChange, disabled, ...field }: CheckboxListProps) {
  return <fieldset id={field.id} className="xp-ui-field xp-ui-checkbox-list" disabled={disabled}
    aria-invalid={Boolean(field.error) || undefined} aria-describedby={described(field, field['aria-describedby'])}>
    <legend>{field.label}</legend>
    {options.map((option, index) => <Checkbox key={option.value} id={`${field.id}-${index}`} label={option.label}
      checked={value.includes(option.value)} disabled={disabled || option.disabled}
      aria-invalid={Boolean(field.error) || undefined} aria-describedby={described(field, field['aria-describedby'])}
      onChange={event => onChange(event.target.checked ? [...value, option.value] : value.filter(item => item !== option.value))} />)}
    {field.help ? <p className="xp-ui-help" id={`${field.id}-help`}>{field.help}</p> : null}
    {field.error ? <p className="xp-ui-error" id={`${field.id}-error`} role="alert">{field.error}</p> : null}
  </fieldset>
}
export function Range({ label, help, error, className = '', ...props }: Omit<TextInputProps, 'type'>) {
  const field = { id: props.id, label, help, error }
  return <Field {...field}><input {...props} type="range" className={`xp-ui-range ${className}`}
    aria-invalid={Boolean(error) || undefined} aria-describedby={described(field, props['aria-describedby'])} /></Field>
}
