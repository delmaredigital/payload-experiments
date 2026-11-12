'use client'

import { registerOverlayPortal } from '@puckeditor/core'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export const CONTROL_SELECTOR = 'button, a, label, input, select, textarea, [role="tab"], dialog, [role="dialog"], [contenteditable="true"]'

/** Give React a delegation boundary before Puck's native component click listeners.
 * A normal React onClick runs too late: native child/parent selection already ran.
 * The portal target is this chrome element in the canvas's ownerDocument, so
 * React delegates here inside Puck's iframe too, before its component listener.
 * Puck 0.24 chunk-DQXMVPVM.mjs:3754–3778, 3847, 12996–12999.
 */
export function EditorControls({ children, className, selected, onSelect }: { children: ReactNode; className: string; selected?: boolean; onSelect?: () => void }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!element) return
    // Puck 0.24's supported per-element portals. The header must still reach
    // Puck's pointer sensor, even after keyboard focus; only controls disable drag.
    const cleanup = registerOverlayPortal(element, { disableDragOnFocus: false })
    const controls = new Map<Element, (() => void) | undefined>()
    const update = () => {
      for (const [node, release] of controls) if (!element.contains(node)) { release?.(); controls.delete(node) }
      for (const node of element.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
        if (!controls.has(node)) controls.set(node, registerOverlayPortal(node, { disableDrag: true }))
      }
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(element, { childList: true, subtree: true })
    return () => { observer.disconnect(); cleanup?.(); for (const release of controls.values()) release?.() }
  }, [element])
  useEffect(() => {
    if (!element) return
    // Padding belongs to the portal target itself, outside React's portal tree.
    const paddingClick = (event: MouseEvent) => {
      if (event.target !== element) return
      event.stopPropagation()
      onSelect?.()
    }
    element.addEventListener('click', paddingClick)
    return () => element.removeEventListener('click', paddingClick)
  }, [element, onSelect])
  return <div ref={setElement} className={className} data-selected={selected}>
    {element ? createPortal(<div className="xp-slot-control-events" onClick={event => {
      event.stopPropagation()
      if (!(event.target as Element).closest(CONTROL_SELECTOR)) onSelect?.()
    }} onKeyDown={event => event.stopPropagation()}>{children}</div>, element) : null}
  </div>
}
