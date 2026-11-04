import type { HTMLAttributes, ReactNode } from 'react'
import './ui.css'
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={`xp-ui-card ${className}`} /> }
export function SectionCard({ number, title, complete = false, children, id, headingId, className = '' }: { number: number; title: string; complete?: boolean; children: ReactNode; id?: string; headingId?: string; className?: string }) {
  return <section id={id} aria-labelledby={headingId} className={`xp-ui-card xp-ui-section ${className}`}><header className="xp-ui-section-head"><span className="xp-ui-section-number">{number}</span>
    <h2 id={headingId} tabIndex={-1}>{title}</h2><span className="xp-ui-section-complete" aria-label={complete ? 'Complete' : 'Incomplete'}>{complete ? '✓' : '○'}</span></header>
    <div className="xp-ui-section-body">{children}</div></section>
}
