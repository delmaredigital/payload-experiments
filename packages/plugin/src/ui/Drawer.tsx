'use client'
import type { ReactNode } from 'react'
import { Button } from './Button.js'
import { Dialog } from './Dialog.js'

/** Native modal drawer: focus trap/restoration and Escape come from Dialog. */
export function Drawer({ title, closeLabel, onClose, children, actions }: {
  title: string; closeLabel: string; onClose: () => void; children: ReactNode; actions?: ReactNode
}) {
  return <Dialog open title={title} onClose={onClose} closeOnBackdrop className="xp-ui-drawer"
    headerActions={<div className="xp-ui-button-group">{actions}<Button variant="quiet" onClick={onClose}>{closeLabel}</Button></div>}>
    <div className="xp-ui-drawer-body">{children}</div>
  </Dialog>
}
