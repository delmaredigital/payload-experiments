'use client'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'
import './ui.css'
type Shared = { variant?: 'primary' | 'secondary' | 'quiet' | 'link' | 'danger'; size?: 'md' | 'sm'; disabled?: boolean; busy?: boolean }
export type ButtonProps = Shared & (ButtonHTMLAttributes<HTMLButtonElement> & { href?: never } | AnchorHTMLAttributes<HTMLAnchorElement> & { href: string })
export function Button({ variant = 'secondary', size = 'md', disabled, busy, className = '', children, ...props }: ButtonProps) {
  const classes = `xp-ui-button xp-ui-button--${variant} xp-ui-button--${size} ${className}`
  const blocked = disabled || busy
  if (props.href !== undefined) {
    const { href, onClick, ...rest } = props as AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }
    return <a {...rest} className={classes} href={blocked ? undefined : href} role={blocked ? 'link' : undefined}
      aria-disabled={blocked || undefined} aria-busy={busy || undefined} tabIndex={blocked ? -1 : rest.tabIndex}
      onClick={event => { if (blocked) event.preventDefault(); else onClick?.(event) }}>{children}</a>
  }
  return <button {...props as ButtonHTMLAttributes<HTMLButtonElement>} type={(props as ButtonHTMLAttributes<HTMLButtonElement>).type ?? 'button'}
    className={classes} disabled={blocked} aria-busy={busy || undefined}>{children}</button>
}
