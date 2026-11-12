'use client'
import { Banner, Button, ConfirmationModal, toast, useModal, useFormInitializing, useRowLabel } from '@payloadcms/ui'
import type { UIFieldClientProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { useEffect, useId, useRef, useState } from 'react'
import { copyOriginalIntoVersion, syncExperimentSlots, unwrapExperimentBlock } from '../../blocks/formState.js'
import { BLOCK_COPY, blockSyncNotice, blockUnwrapNotice, blockDeleteConfirmation, blockUnwrapConfirmation, blockRunningUnwrap, blockDecidedUnwrap, blockFinishedCopy } from '../../admin/copy/blocks.js'
import { API_MESSAGES } from '../../testSurface/copy/common.js'
import { isOrphan, liveStatus, slotLabel, statusSentence } from './model.js'
import { createApi } from '../../testSurface/api.js'
import { useBlockStatus, setBlockStatus } from './statusCache.js'
import { useBlockForm } from './useBlockForm.js'
import { BlockChangedError, RefusalError } from './formApi.js'

function errorMessage(error: unknown): string {
  return error instanceof BlockChangedError || error instanceof RefusalError ? error.message : API_MESSAGES.failed
}

export function BlockStatusField({ path }: UIFieldClientProps) {
  const context = useBlockForm(path), { block, field, manager, config, collection, replace } = context
  const initializing = useFormInitializing()
  const status = useBlockStatus(config.routes.api, block?.experiment, true)
  const synced = useRef(false), syncing = useRef(false)
  const [notice, setNotice] = useState(false), [error, setError] = useState<string>(), [busy, setBusy] = useState(false)
  const [syncError, setSyncError] = useState<string>()
  const { openModal } = useModal()
  const modalSlug = `xp-unwrap-${useId()}`
  const canSync = !initializing && manager && block && field && liveStatus(status) && ['draft', 'stopped'].includes(status.status)
  async function sync() {
    if (!canSync || syncing.current) return
    syncing.current = true; setBusy(true); setSyncError(undefined)
    try {
      const next = syncExperimentSlots(block, status.arms, field)
      if (JSON.stringify(next.slots) !== JSON.stringify(block.slots)) {
        await replace([next]); setNotice(true)
      }
    } catch (error) { setSyncError(errorMessage(error)) }
    finally { syncing.current = false; setBusy(false) }
  }
  useEffect(() => {
    if (synced.current || !canSync) return
    synced.current = true
    void sync()
  })
  if (!status || !manager) return null
  const draft = liveStatus(status) && status.status === 'draft'
  const stopped = liveStatus(status) && status.status === 'stopped'
  async function unwrap() {
    if (!block || !field || busy) return
    setBusy(true); setError(undefined)
    let deleted = false
    try {
      if (draft) {
        const api = createApi(config.routes.api)
        const found = await api.findTestIdBySlug(block.experiment)
        if (!found.ok) throw new RefusalError(found.message)
        const removed = await api.deleteTest(found.data)
        if (!removed.ok) throw new RefusalError(removed.message)
        deleted = true
        setBlockStatus(config.routes.api, block.experiment, { deleted: true })
      }
      await replace(unwrapExperimentBlock(block, field))
      toast.success(blockUnwrapNotice(Boolean(collection?.versions?.drafts), deleted))
    } catch (error) { setError(deleted ? BLOCK_COPY.finishUnwrap : errorMessage(error)) }
    finally { setBusy(false) }
  }
  const sentence = statusSentence(status)
  const linkedCopy = liveStatus(status) ? status.status === 'running' ? blockRunningUnwrap
    : status.status === 'decided' ? blockDecidedUnwrap
      : status.status === 'archived' && status.winnerArm ? blockFinishedCopy(slotLabel(status.winnerArm, status)) : undefined : undefined
  const href = formatAdminURL({ adminRoute: config.routes.admin, path: `/experiments/by-slug/${encodeURIComponent(block?.experiment ?? '')}` })
  return <div>
    {liveStatus(status) && status.status === 'running' ? <Banner>{sentence}</Banner> : linkedCopy && liveStatus(status) && status.status === 'archived' ? null : <p>{sentence}</p>}
    {linkedCopy ? <p>{linkedCopy.before}<a href={href}>{linkedCopy.link}</a>{linkedCopy.after}</p> : null}
    {notice ? <p role="status">{blockSyncNotice(Boolean(collection?.versions?.drafts))}</p> : null}
    {isOrphan(status) || draft || stopped ? <Button disabled={busy} onClick={() => draft || stopped ? openModal(modalSlug) : void unwrap()}>{draft ? BLOCK_COPY.removeAndUnwrap : BLOCK_COPY.unwrap}</Button> : null}
    {draft || stopped ? <ConfirmationModal modalSlug={modalSlug} heading={draft ? BLOCK_COPY.removeAndUnwrap : BLOCK_COPY.unwrap}
      body={draft ? blockDeleteConfirmation(status.name) : blockUnwrapConfirmation(status.name)}
      confirmLabel={draft ? BLOCK_COPY.deleteAndUnwrap : BLOCK_COPY.unwrap} cancelLabel={BLOCK_COPY.cancel} onConfirm={unwrap} /> : null}
    {error ? <p role="alert">{error}</p> : null}
    {syncError ? <p role="alert">{syncError}</p> : null}
    {syncError && canSync ? <Button disabled={busy} onClick={() => void sync()}>{BLOCK_COPY.retry}</Button> : null}
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
  const { openModal } = useModal()
  const modalSlug = `xp-copy-original-${useId()}`
  if (!manager || !field || !block || !slot || slot === 'control' || !liveStatus(status) || !['draft', 'stopped', 'running'].includes(status.status)) return null
  async function copy() {
    if (!block || !field || busy || !slot) return
    setBusy(true); setError(undefined)
    try { await replace([copyOriginalIntoVersion(block, slot, field)]) } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  function requestCopy() {
    if (block?.slots.find(row => row.slot === slot)?.blocks?.length) openModal(modalSlug)
    else void copy()
  }
  return <div><Button disabled={busy} onClick={requestCopy}>{BLOCK_COPY.copy}</Button>
    <ConfirmationModal modalSlug={modalSlug} heading={BLOCK_COPY.copy} body={BLOCK_COPY.confirmCopy}
      confirmLabel={BLOCK_COPY.replace} cancelLabel={BLOCK_COPY.cancel} onConfirm={copy} />
    {error ? <p role="alert">{error}</p> : null}</div>
}
