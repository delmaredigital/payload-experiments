'use client'
import { Banner, Button, useFormInitializing, useRowLabel } from '@payloadcms/ui'
import type { UIFieldClientProps } from 'payload'
import { useEffect, useRef, useState } from 'react'
import { copyOriginalIntoVersion, syncExperimentSlots, unwrapExperimentBlock } from '../../blocks/formState.js'
import { BLOCK_COPY, blockSyncNotice } from '../copy/blocks.js'
import { API_MESSAGES } from '../copy/common.js'
import { isOrphan, liveStatus, slotLabel, statusSentence } from './model.js'
import { useBlockStatus } from './statusCache.js'
import { useBlockForm } from './useBlockForm.js'

export function BlockStatusField({ path }: UIFieldClientProps) {
  const context = useBlockForm(path), { block, field, manager, config, collection, replace } = context
  const initializing = useFormInitializing()
  const status = useBlockStatus(config.routes.api, block?.experiment, true)
  const synced = useRef(false), [notice, setNotice] = useState(false), [error, setError] = useState<string>(), [busy, setBusy] = useState(false)
  useEffect(() => {
    if (synced.current || initializing || !manager || !block || !field || !liveStatus(status) || !['draft', 'stopped'].includes(status.status)) return
    synced.current = true
    const next = syncExperimentSlots(block, status.arms, field)
    if (JSON.stringify(next.slots) === JSON.stringify(block.slots)) return
    void replace([next]).then(() => setNotice(true)).catch(() => setError(API_MESSAGES.failed))
  })
  if (!status) return null
  async function unwrap() {
    if (!block || !field || busy) return
    setBusy(true); setError(undefined)
    try { await replace(unwrapExperimentBlock(block, field)) } catch { setError(API_MESSAGES.failed) }
    finally { setBusy(false) }
  }
  const sentence = statusSentence(status)
  return <div>
    {liveStatus(status) && status.status === 'running' ? <Banner>{sentence}</Banner> : <p>{sentence}</p>}
    {notice ? <p role="status">{blockSyncNotice(Boolean(collection?.versions?.drafts))}</p> : null}
    {manager && isOrphan(status) ? <Button disabled={busy} onClick={() => void unwrap()}>{BLOCK_COPY.unwrap}</Button> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>
}

export function BlockSlotRowLabel() {
  const { data, path } = useRowLabel<{ slot?: string }>()
  const { config, block } = useBlockForm(path)
  const status = useBlockStatus(config.routes.api, block?.experiment)
  return <span>{slotLabel(data?.slot ?? '', status)}</span>
}

export function CopyOriginalField({ path }: UIFieldClientProps) {
  const { block, field, form, manager, config, replace } = useBlockForm(path)
  const status = useBlockStatus(config.routes.api, block?.experiment)
  const rowPath = path.slice(0, path.lastIndexOf('.'))
  const slot = form.getDataByPath<string>(`${rowPath}.slot`)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>()
  if (!manager || !field || !block || !slot || slot === 'control' || !liveStatus(status) || !['draft', 'stopped', 'running'].includes(status.status)) return null
  async function copy() {
    if (!block || !field || busy || !slot) return
    const row = block.slots.find(row => row.slot === slot)
    if (row?.blocks?.length && !window.confirm(BLOCK_COPY.confirmCopy)) return
    setBusy(true); setError(undefined)
    try { await replace([copyOriginalIntoVersion(block, slot, field)]) } catch { setError(API_MESSAGES.failed) }
    finally { setBusy(false) }
  }
  return <div><Button disabled={busy} onClick={() => void copy()}>{BLOCK_COPY.copy}</Button>{error ? <p role="alert">{error}</p> : null}</div>
}
