'use client'

import { useId, useState } from 'react'
import type { ExperimentRef } from '../../types/puck.js'
import { slugify } from './editor.model.js'
import { editorCopy } from './copy.js'

export function CreateExperimentDrawer({ onCreate, onClose }: {
  onCreate: (experiment: ExperimentRef) => void
  onClose: () => void
}) {
  const titleId = useId()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submitNew() {
    setPending(true)
    setError('')
    try {
      const response = await fetch('/api/xp-experiments', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug, kind: 'block', unitType: 'visitor' }),
      })
      const body = await response.json()
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
      setPending(false)
    }
  }

  return <aside role="dialog" aria-labelledby={titleId} style={{ padding: 16, border: '1px solid #aaa', background: 'Canvas', color: 'CanvasText' }}>
    <h3 id={titleId}>{editorCopy.createLabel}</h3>
    <label style={{ display: 'block', marginBottom: 8 }}>{editorCopy.name}
      <input value={name} disabled={pending} onChange={event => {
        setName(event.currentTarget.value)
        if (!slugEdited) setSlug(slugify(event.currentTarget.value))
      }} />
    </label>
    <label style={{ display: 'block', marginBottom: 8 }}>{editorCopy.slug}
      <input value={slug} maxLength={64} disabled={pending} onChange={event => { setSlugEdited(true); setSlug(event.currentTarget.value) }} />
    </label>
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" disabled={pending || !name.trim() || !slug.trim()} onClick={() => { void submitNew() }}>{pending ? editorCopy.creating : editorCopy.createLabel}</button>
    <button type="button" disabled={pending} onClick={onClose}>{editorCopy.cancel}</button>
  </aside>
}
