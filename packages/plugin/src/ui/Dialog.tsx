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
/** Native modal stays in its rendering document, including a Puck canvas iframe.
 * `initialFocus="cancel"` targets the focusable control marked `data-dialog-cancel`.
 */
export function Dialog({ open, title, onClose, children, dismissible = true, initialFocus, className = '', headerActions, closeOnBackdrop = false }: { open: boolean; className?: string; headerActions?: ReactNode; closeOnBackdrop?: boolean; dismissible?: boolean; initialFocus?: 'cancel'; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const backdropPress = useRef(false)
  const onBackdrop = (event: { target: EventTarget | null; clientX: number; clientY: number }) => {
    const node = ref.current
    if (!node || event.target !== node) return false
    const rect = node.getBoundingClientRect()
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom
  }
  const closeRequested = useRef(false)
  const requestClose = () => {
    if (!open || !dismissible || closeRequested.current) return
    closeRequested.current = true
    onClose()
  }
  useEffect(() => {
    const node = ref.current
    if (!node || !open) return
    const doc = node.ownerDocument
    const previous = doc.activeElement as HTMLElement | null
    closeRequested.current = false
    // Observe before overlay portals stop pointerdown during ancestor capture.
    const down = (event: PointerEvent) => { backdropPress.current = onBackdrop(event) }
    const up = (event: PointerEvent) => { if (!onBackdrop(event)) backdropPress.current = false }
    const cancel = () => { backdropPress.current = false }
    doc.addEventListener('pointerdown', down, true)
    doc.addEventListener('pointerup', up, true)
    doc.addEventListener('pointercancel', cancel, true)
    node.showModal()
    const elements = focusable(node)
    const preferred = initialFocus === 'cancel' ? elements.find(element => element.hasAttribute('data-dialog-cancel')) : undefined
    ;(preferred ?? elements[0] ?? node).focus()
    return () => { doc.removeEventListener('pointerdown', down, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('pointercancel', cancel, true); node.close(); if (previous?.isConnected) previous.focus() }
  }, [open, initialFocus])
  return <dialog ref={ref} aria-labelledby={heading} className={`xp-ui-dialog ${className}`} tabIndex={-1} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); requestClose() }}
    onClick={event => {
      const startedOnBackdrop = backdropPress.current
      backdropPress.current = false
      if (closeOnBackdrop && startedOnBackdrop && onBackdrop(event)) requestClose()
    }}
    onKeyDown={event => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') { event.preventDefault(); requestClose(); return }
      if (event.key !== 'Tab') return
      const node = event.currentTarget
      const elements = focusable(node)
      const first = elements[0], last = elements.at(-1), active = node.ownerDocument.activeElement
      if (!first) { event.preventDefault(); node.focus() }
      else if (event.shiftKey && (active === first || active === node)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (active === last || active === node)) { event.preventDefault(); first.focus() }
    }}>{headerActions ? <header className="xp-ui-dialog-header"><h2 id={heading}>{title}</h2>{headerActions}</header> : <h2 id={heading}>{title}</h2>}{children}</dialog>
}
