import type { ExperimentRef } from '../../types/puck.js'
import { editorCopy } from './copy.js'
import { isSlugCollision, newTestBody, slugify, uniqueSlug } from './editor.model.js'

/** Only a server refusal may supply editor-facing error text. */
export class CreateRefused extends Error {}

function refusalMessage(body: unknown): string {
  const error = body as { errors?: Array<{ data?: { errors?: Array<{ message?: unknown }> } }> } | null
  const message = error?.errors?.[0]?.data?.errors?.[0]?.message
  return typeof message === 'string' && message.trim() ? message : editorCopy.createError
}

/** Shared lookup, complete draft creation and one retry for a racing slug collision. */
export async function createTest(api: string, input: Omit<Parameters<typeof newTestBody>[0], 'slug'>): Promise<ExperimentRef> {
  const base = slugify(input.name) || 'test'
  for (let attempt = 0; ; attempt++) {
    // Suffixes shorten a 64-character base; include those neighbouring slugs in the lookup.
    const lookup = await fetch(`${api}/xp-experiments?where[slug][like]=${encodeURIComponent(base.slice(0, 60))}&depth=0&limit=200&select[slug]=true`, { credentials: 'include' })
    const found = await lookup.json()
    if (!lookup.ok) throw new CreateRefused(refusalMessage(found))
    if (!Array.isArray(found?.docs)) throw new Error(editorCopy.createError)
    const taken = found.docs.flatMap((doc: { slug?: unknown }) => typeof doc.slug === 'string' ? [doc.slug] : [])
    const response = await fetch(`${api}/xp-experiments`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTestBody({ ...input, slug: uniqueSlug(base, taken) })),
    })
    const body = await response.json()
    if (!response.ok) {
      if (isSlugCollision(response.status, body)) {
        if (attempt === 0) continue
        throw new CreateRefused(editorCopy.nameExists)
      }
      throw new CreateRefused(refusalMessage(body))
    }
    const doc = body?.doc
    if ((typeof doc?.id !== 'string' && typeof doc?.id !== 'number') || typeof doc?.slug !== 'string') throw new Error(editorCopy.createError)
    return { id: doc.id, slug: doc.slug }
  }
}
