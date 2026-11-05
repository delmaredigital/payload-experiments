'use client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createApi } from '../../api.js'
import { PAGE_COPY as C } from '../../copy/pages.js'
import type { TestDocApi } from '../contracts.js'
import { reasonFor } from '../test/fields.js'
import { disabledPageReason, isLatestPageRequest } from './pagePicker.model.js'
import type { PageCollection, PageRow } from './pagePicker.model.js'

/** Mount on open; every reopen and return from another tab refreshes the current query. */
export function PagePicker({ collection, test, armKey, apiRoute, onChoose }: {
  collection: PageCollection; test: TestDocApi; armKey: string; apiRoute: string; onChoose?: () => void
}) {
  const api = useMemo(() => createApi(apiRoute), [apiRoute])
  const id = useId()
  const [search, setSearch] = useState('')
  const [q, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [rows, setRows] = useState<PageRow[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const revision = useRef(0)
  const reload = () => { setPage(1); setRefresh(value => value + 1) }
  useEffect(() => {
    if (search === q) return
    const timer = setTimeout(() => { setQuery(search); setPage(1) }, 250)
    return () => clearTimeout(timer)
  }, [search, q])
  useEffect(() => {
    let lastReturn = -Infinity
    const focus = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastReturn < 100) return
      lastReturn = Date.now()
      setPage(1); setRefresh(value => value + 1)
    }
    const visible = () => { if (document.visibilityState === 'visible') focus() }
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible)
    return () => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    const request = ++revision.current
    setLoading(true); setError('')
    void api.pages({ collection: collection.slug, q, page }, controller.signal).then(result => {
      if (controller.signal.aborted || !isLatestPageRequest(request, revision.current)) return
      if (result.ok && result.data) {
        const docs = result.data.docs
        setRows(current => {
          const combined = page === 1 ? docs : [...current, ...docs]
          return combined.filter((row, index) => combined.findIndex(item => item.id === row.id) === index)
        })
        setMore(result.data.hasNextPage)
      } else { setMore(false); setError(C.error) }
      setLoading(false)
    })
    return () => controller.abort()
  }, [api, collection.slug, q, page, refresh])
  const reason = reasonFor(test, 'arms')
  return <div className="xp-page-picker">
    <label htmlFor={id}>{C.search}</label><input id={id} type="search" value={search} onChange={event => setSearch(event.currentTarget.value)} />
    {loading && !rows.length ? <p role="status">{C.loading}</p> : null}
    {error ? <p role="alert">{error} <button type="button" onClick={reload}>{C.retry}</button></p> : null}
    {!rows.length ? !loading && !error ? <p>{C.empty}</p> : null : <ul>{rows.map(row => {
        const disabled = reason ?? disabledPageReason(row, armKey, test.doc?.arms ?? [], test.preflight?.pagePlacements, test.chosenPages, collection.label, collection.slug)
        return <li key={row.id}><button type="button" disabled={!!disabled || test.saving === 'saving'} onClick={() => {
          const arm = test.doc?.arms.find(item => item.key === armKey)
          if (!arm || row.path === null || disabled) return
          void test.choosePage(arm.key, { id: row.id, path: row.path })
          onChoose?.()
        }}><strong>{row.title}</strong>{' '}{row.path}{!row.published ? <> · {C.draft}</> : null}</button>{disabled ? <p>{disabled}</p> : null}</li>
    })}</ul>}
    {more ? <button type="button" disabled={loading} onClick={() => setPage(value => value + 1)}>{C.more}</button> : null}
  </div>
}
