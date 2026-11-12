'use client'

import { registerOverlayPortal } from '@puckeditor/core'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Give React a delegation boundary before Puck's native component click listeners.
 * A normal React onClick runs too late: native child/parent selection already ran.
 * The portal target is this chrome element in the canvas's ownerDocument, so
 * React delegates here inside Puck's iframe too, before its component listener.
 * Puck 0.24 chunk-DQXMVPVM.mjs:3754–3778, 3847, 12996–12999.
 */
export function EditorControls({ children, className, selected }: { children: ReactNode; className: string; selected?: boolean }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  useEffect(() => registerOverlayPortal(element, { disableDrag: true }), [element])
  return <div ref={setElement} className={className} data-selected={selected}>
    {element ? createPortal(<div className="xp-slot-control-events" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>{children}</div>, element) : null}
  </div>
}
