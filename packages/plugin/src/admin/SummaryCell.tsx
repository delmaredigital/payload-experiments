'use client'

import { useEffect, useState } from 'react'
import type { DefaultCellComponentProps } from 'payload'
import { useApi } from './useApi.js'
import { verdictCodeLabel } from './labels.js'
import { summaryLine } from './copy/results.js'
import { formatCount, formatNumber } from './results/format.js'
import { requestSummary } from './summaryBatcher.js'
import type { SummaryEntry } from './summaryBatcher.js'

export function SummaryCell({ rowData }: DefaultCellComponentProps) {
  const api = useApi()
  const id = rowData.id
  const [state, setState] = useState<{ id: typeof id; entry: SummaryEntry | null } | null>(null)
  useEffect(() => {
    let active = true
    if (id !== undefined && id !== null) void requestSummary(api, id).then(entry => {
      if (active) setState({ id, entry })
    })
    return () => { active = false }
  }, [api, id])
  const entry = state?.id === id ? state?.entry : null
  return <span>{entry ? summaryLine(formatCount(entry.exposures), formatNumber(entry.days), entry.verdict ? verdictCodeLabel(entry.verdict.code) : '—') : '—'}</span>
}
