'use client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createApi } from '../../api.js'
import { PAGE_COPY as C, pageFieldCopy, pageNotFoundCopy } from '../../copy/pages.js'
import { TextInput } from '../../../ui/TextInput.js'
import { normalisePath } from '../../../runtime/normalisePath.js'
import type { TestDocApi } from '../contracts.js'
import { reasonFor } from '../test/fields.js'
import { disabledPageReason, isLatestPageRequest } from './pagePicker.model.js'
import type { PageCollection, PageRow } from './pagePicker.model.js'
import './pagePicker.css'

type Choice = { path: string | null; title?: string; published?: boolean }
const display = (row: Choice) => `${row.title ? `${row.title} · ` : ''}${row.path ?? ''}${row.published === false ? ` · ${C.draft}` : ''}`

/** One input owns focus; list options are navigated through aria-activedescendant. */
export function PageCombobox({ collection, test, armKey, apiRoute }: {
  collection: PageCollection; test: TestDocApi; armKey: string; apiRoute: string
}) {
  const api = useMemo(() => createApi(apiRoute), [apiRoute])
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const arm = test.doc?.arms.find(item => item.key === armKey)
  const target = arm?.pageTarget || ''
  const matches = (path: string | null | undefined) => Boolean(target && path != null && normalisePath(path) === normalisePath(target))
  const remembered = arm && test.chosenPages[arm.key]
  const chosen = remembered && matches(remembered.path) ? remembered : undefined
  const placement = test.preflight?.pagePlacements?.find(entry => entry.arm === armKey && entry.collection === collection.slug && entry.id != null && matches(entry.path))
  const resolved = chosen ?? placement
  const needsLookup = Boolean(target && !resolved)
  const lookupKey = JSON.stringify([collection.slug, target])
  const lookups = useRef<Record<string, { row?: PageRow; missing?: boolean } | undefined>>({})
  const [, updateLookup] = useState(0)
  const lookupRevision = useRef(0)
  useEffect(() => {
    if (!needsLookup || lookups.current[lookupKey]) return
    const controller = new AbortController()
    const request = ++lookupRevision.current
    const pending = {}
    const discardPending = () => { if (lookups.current[lookupKey] === pending) delete lookups.current[lookupKey] }
    // Defer dispatch so StrictMode's discarded effect cannot cache an aborted attempt.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      lookups.current[lookupKey] = pending
      const result = await api.pages({ collection: collection.slug, path: target }, controller.signal)
      if (controller.signal.aborted || !isLatestPageRequest(request, lookupRevision.current)) { discardPending(); return }
      lookups.current[lookupKey] = result.ok && result.data ? { row: result.data.docs[0], missing: result.data.docs.length === 0 } : {}
      updateLookup(value => value + 1)
    })
    return () => { controller.abort(); discardPending() }
  }, [api, collection.slug, target, lookupKey, needsLookup])
  const lookup = lookups.current[lookupKey]
  const value = resolved ? display(resolved) : !target ? '' : lookup?.missing ? pageNotFoundCopy(target, collection.label) : lookup?.row ? (lookup.row.title ? display(lookup.row) : target) : target
  const currentId = resolved?.id ?? lookup?.row?.id
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [q, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [rows, setRows] = useState<PageRow[]>([])
  const [more, setMore] = useState(false)
  const [reveal, setReveal] = useState(8)
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const revision = useRef(0)
  const firstNew = useRef<number | null>(null)
  const locked = reasonFor(test, 'arms')
  const saving = test.saving === 'saving'
  const blocked = Boolean(locked || saving)
  const reset = () => { setPage(1); setReveal(8); setActive(null); firstNew.current = null; setRefresh(value => value + 1) }
  const close = () => { setOpen(false); setActive(null) }
  const show = (query = '') => {
    if (blocked || open) return
    setSearch(query); setQuery(query); setRows([]); setMore(false); setActive(null); reset(); setOpen(true)
  }
  useEffect(() => {
    if (search === q) return
    const timer = setTimeout(() => { setQuery(search); setPage(1); setReveal(8) }, 250)
    return () => clearTimeout(timer)
  }, [search, q])
  useEffect(() => {
    if (!open) return
    let lastReturn = -Infinity
    const focus = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastReturn < 100) return
      lastReturn = Date.now()
      reset()
    }
    const visible = () => { if (document.visibilityState === 'visible') focus() }
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) close() }
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible); document.addEventListener('pointerdown', outside); document.addEventListener('click', outside)
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible); document.removeEventListener('pointerdown', outside); document.removeEventListener('click', outside) }
  }, [open])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const request = ++revision.current
    setLoading(true); setError('')
    void api.pages({ collection: collection.slug, q, page }, controller.signal).then(result => {
      if (controller.signal.aborted || !isLatestPageRequest(request, revision.current)) return
      if (result.ok && result.data) {
        // These rows belong to this request; a reset/search aborts it. Commit the
        // pending highlight with the rows, before a final page can remove More.
        const combined = page === 1 ? result.data.docs : [...rows, ...result.data.docs]
        const nextRows = combined.filter((row, index) => combined.findIndex(item => item.id === row.id) === index)
        setRows(nextRows)
        if (firstNew.current != null) {
          const row = nextRows[firstNew.current]
          setActive(row ? String(row.id) : null)
          firstNew.current = null
        }
        setMore(result.data.hasNextPage)
      } else { setMore(false); setError(C.error); firstNew.current = null }
      setLoading(false)
    })
    return () => controller.abort()
  }, [api, collection.slug, q, page, refresh, open])
  const visibleRows = rows.slice(0, reveal)
  const hasMore = rows.length > reveal || more
  const optionKeys = [...visibleRows.map(row => String(row.id)), ...(hasMore ? ['more'] : [])]
  const activeKey = active != null && optionKeys.includes(active) ? active : undefined
  useEffect(() => {
    if (open && activeKey) root.current?.ownerDocument.getElementById(`${id}-option-${activeKey}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeKey, id])
  const disabled = (row: PageRow) => disabledPageReason(row, armKey, test.doc?.arms ?? [], test.preflight?.pagePlacements, test.chosenPages, collection.label, collection.slug)
  const choose = (key: string) => {
    if (blocked) return
    if (key === 'more') {
      if (loading) return
      const offset = visibleRows.length
      const nextReveal = offset + 8
      setReveal(nextReveal)
      if (rows[offset]) setActive(String(rows[offset]!.id))
      else firstNew.current = offset
      if (more && rows.length < nextReveal) { setLoading(true); setPage(count => count + 1) }
      return
    }
    const row = rows.find(item => String(item.id) === key)
    if (!arm || !row || row.path === null || disabled(row)) return
    void test.choosePage(arm.key, { id: row.id, path: row.path, title: row.title, published: row.published })
    close()
    root.current?.querySelector('input')?.focus()
  }
  const label = pageFieldCopy(arm?.label ?? armKey)
  return <div ref={root} className="xp-page-combobox">
    <TextInput id={id} label={label} role="combobox" aria-autocomplete="list" autoComplete="off"
      aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && activeKey ? `${id}-option-${activeKey}` : undefined}
      placeholder={C.choose} value={open ? search : value} disabled={Boolean(locked)} readOnly={saving} aria-disabled={saving || undefined}
      onClick={() => show()} onBlur={event => { if (!root.current?.contains(event.relatedTarget as Node)) close() }}
      onPaste={event => {
        if (blocked || open) return
        event.preventDefault(); show(event.clipboardData.getData('text/plain'))
      }}
      onChange={event => {
        if (blocked) return
        if (!open) { show((event.nativeEvent as InputEvent).data ?? ''); return }
        const query = event.currentTarget.value
        if (query === q) reset()
        setSearch(query); setRows([]); setMore(false); setActive(null); setReveal(8); setLoading(true); setError(''); firstNew.current = null; revision.current++
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' || event.key === 'Tab' || event.altKey && event.key === 'ArrowUp') {
          if (open) { if (event.key !== 'Tab') event.preventDefault(); close() }
          return
        }
        if (blocked) return
        if (!open && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault(); show(event.key); return
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          if (!open) { show(); return }
          const index = activeKey ? optionKeys.indexOf(activeKey) : event.key === 'ArrowDown' ? -1 : optionKeys.length
          setActive(optionKeys[Math.max(0, Math.min(optionKeys.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))] ?? null)
        } else if (open && activeKey && (event.key === 'Home' || event.key === 'End')) {
          event.preventDefault(); setActive(optionKeys[event.key === 'Home' ? 0 : optionKeys.length - 1] ?? null)
        } else if (open && activeKey && event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); choose(activeKey) }
      }} />
    {open ? <div className="xp-page-combobox-popup">
      <div id={`${id}-list`} role="listbox" aria-label={label}>
        {visibleRows.map(row => {
          const reason = disabled(row)
          const selected = currentId != null ? String(row.id) === String(currentId) : matches(row.path)
          return <div role="option" id={`${id}-option-${row.id}`} key={row.id} aria-selected={selected} aria-disabled={Boolean(reason) || undefined}
            data-active={activeKey === String(row.id) || undefined} className="xp-page-option" onMouseDown={event => event.preventDefault()} onClick={() => choose(String(row.id))}>
            <strong>{row.title}</strong>{selected ? <span className="xp-page-option-check" aria-hidden="true">✓</span> : null}
            <span className="xp-page-option-detail">{row.path}{row.published === false ? ` · ${C.draft}` : ''}{reason ? <><br />{reason}</> : null}</span>
          </div>
        })}
        {hasMore ? <div role="option" id={`${id}-option-more`} className="xp-page-option" data-active={activeKey === 'more' || undefined}
          aria-disabled={loading || undefined} onMouseDown={event => event.preventDefault()} onClick={() => choose('more')}>{C.more}</div> : null}
      </div>
      {loading && !rows.length ? <p role="status">{C.loading}</p> : null}
      {!loading && !error && !rows.length ? <p role="status">{C.empty}</p> : null}
      {error ? <div role="alert">{error} <button type="button" onClick={reset}>{C.retry}</button></div> : null}
    </div> : null}
  </div>
}
