'use client'
import type { ReactNode } from 'react'
import './results.css'

export function StatTile({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return <div className="xp-stat-tile"><div className="xp-stat-tile-label">{label}</div>
    <div className="xp-stat-tile-value">{value}</div>{detail ? <div className="xp-stat-tile-detail">{detail}</div> : null}</div>
}
