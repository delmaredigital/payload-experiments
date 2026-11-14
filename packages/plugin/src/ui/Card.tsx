import type { HTMLAttributes, ReactNode } from 'react'
import './ui.css'
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={`xp-ui-card ${className}`} /> }
export function SectionCard({ number, title, complete = false, blocked = false, children, id, headingId, className = '' }: { number: number; title: string; complete?: boolean; blocked?: boolean; children: ReactNode; id?: string; headingId?: string; className?: string }) {
  return <section id={id} aria-labelledby={headingId} className={`xp-ui-card xp-ui-section ${blocked ? 'xp-ui-section--blocked' : complete ? 'xp-ui-section--complete' : ''} ${className}`}><header className="xp-ui-section-head"><span className="xp-ui-section-number">{number}</span>
    <h2 id={headingId} tabIndex={-1}>{title}</h2><span className="xp-ui-section-complete" aria-label={blocked ? 'Needs attention' : complete ? 'Complete' : 'Incomplete'}>{blocked ? '!' : complete ? '✓' : '○'}</span></header>
    <div className="xp-ui-section-body">{children}</div></section>
}
