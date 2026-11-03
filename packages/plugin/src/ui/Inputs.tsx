'use client'
import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react'
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
