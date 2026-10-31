'use client'
import './styles.js'

import { Pill } from '@payloadcms/ui'
import type { DefaultCellComponentProps } from 'payload'
import type { Status } from '../types/contracts.js'
import { statusPill } from './status.model.js'

export function StatusCell({ cellData, rowData }: DefaultCellComponentProps) {
  const pill = statusPill({ status: cellData as Status, arms: rowData.arms, decision: rowData.decision })
  return <span title={pill.tooltip}><Pill className={`xp-status-pill xp-status-pill--${pill.tone}`}>{pill.label}</Pill></span>
}
