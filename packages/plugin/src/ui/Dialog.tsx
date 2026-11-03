'use client'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import './ui.css'
function focusable(node: HTMLDialogElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')].filter(el => {
    if (el.tabIndex < 0 || el.matches(':disabled, input[type="hidden"]') || el.closest('[hidden], [inert]') || el.getAttribute('aria-disabled') === 'true') return false
    for (let parent: HTMLElement | null = el; parent && parent !== node; parent = parent.parentElement) {
      const style = node.ownerDocument.defaultView?.getComputedStyle(parent)
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false
    }
    return true
  })
}
/** Native modal stays in its rendering document, including a Puck canvas iframe. */
export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const heading = useId()
  useEffect(() => {
    const node = ref.current
    if (!node || !open) return
    const doc = node.ownerDocument
    const previous = doc.activeElement as HTMLElement | null
    node.showModal()
    const first = focusable(node)[0]
    ;(first ?? node).focus()
    return () => { node.close(); if (previous?.isConnected) previous.focus() }
  }, [open])
  return <dialog ref={ref} aria-labelledby={heading} className="xp-ui-dialog" tabIndex={-1} onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const node = event.currentTarget
      const elements = focusable(node)
      const first = elements[0], last = elements.at(-1), active = node.ownerDocument.activeElement
      if (!first) { event.preventDefault(); node.focus() }
      else if (event.shiftKey && (active === first || active === node)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (active === last || active === node)) { event.preventDefault(); first.focus() }
    }}><h2 id={heading}>{title}</h2>{children}</dialog>
}
