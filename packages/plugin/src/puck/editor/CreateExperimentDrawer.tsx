'use client'

import { useId, useRef, useState } from 'react'
import type { ExperimentRef } from '../../types/puck.js'
import { isSlugCollision, newTestBody, slugify, uniqueSlug } from './editor.model.js'
import { editorCopy } from './copy.js'

export function CreateExperimentDrawer({ onCreate, onClose, initialName = '' }: {
  initialName?: string
  onCreate: (experiment: ExperimentRef) => void
  onClose: () => void
}) {
  const titleId = useId()
  const [name, setName] = useState(initialName)
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submitNew() {
    if (inFlight.current || !name.trim()) return
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      const base = slugify(name) || 'test'
      let response: Response
      let body
      for (let attempt = 0; ; attempt++) {
        // Include shortened bases too, since a numeric suffix must fit within 64 characters.
        const query = await fetch(`/api/xp-experiments?where[slug][like]=${encodeURIComponent(base.slice(0, 60))}&depth=0&limit=200&select[slug]=true`, { credentials: 'include' })
        const found = await query.json()
        if (!query.ok || !Array.isArray(found?.docs)) throw new Error('lookup')
        const taken = found.docs.flatMap((doc: { slug?: unknown }) => typeof doc.slug === 'string' ? [doc.slug] : [])
        const slug = uniqueSlug(base, taken)
        response = await fetch('/api/xp-experiments', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newTestBody({ name, slug, kind: 'block', unitType: 'visitor' })),
        })
        body = await response.json()
        if (attempt === 0 && isSlugCollision(response.status, body)) continue
        break
      }
      if (!response.ok) {
        setError(typeof body?.errors?.[0]?.message === 'string' ? body.errors[0].message : editorCopy.createError)
        return
      }
      const doc = body?.doc
      if (!doc || (typeof doc.id !== 'string' && typeof doc.id !== 'number') || typeof doc.slug !== 'string') {
        setError(editorCopy.createError)
        return
      }
      onCreate({ id: doc.id, slug: doc.slug })
      onClose()
    } catch {
      setError(editorCopy.createError)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return <aside role="dialog" aria-labelledby={titleId} style={{ padding: 16, border: '1px solid #aaa', background: 'Canvas', color: 'CanvasText' }}>
    <h3 id={titleId}>{editorCopy.createLabel}</h3>
    <label style={{ display: 'block', marginBottom: 8 }}>{editorCopy.name}
      <input value={name} disabled={pending} onChange={event => setName(event.currentTarget.value)} />
    </label>
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" disabled={pending || !name.trim()} onClick={() => { void submitNew() }}>{pending ? editorCopy.creating : editorCopy.createLabel}</button>
    <button type="button" disabled={pending} onClick={onClose}>{editorCopy.cancel}</button>
  </aside>
}
