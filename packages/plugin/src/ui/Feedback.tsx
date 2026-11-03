import type { ReactNode } from 'react'
import './ui.css'
export const statusLabels = { draft: 'Draft', ready: 'Ready', running: 'Running', 'needs-attention': 'Needs attention', decided: 'Decided', archived: 'Archived', stopped: 'Stopped' } as const
export type UIStatus = keyof typeof statusLabels
export function StatusChip({ status }: { status: UIStatus }) { return <span className={`xp-ui-status xp-ui-status--${status}`}>{statusLabels[status]}</span> }
export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warning' | 'error'; children: ReactNode; action?: ReactNode }) {
  return <div className={`xp-ui-banner xp-ui-banner--${tone}`} role={tone === 'error' ? 'alert' : 'status'}><p>{children}</p>{action}</div>
}
export function EmptyState({ children, action }: { children: ReactNode; action: ReactNode }) { return <div className="xp-ui-empty"><p>{children}</p>{action}</div> }
