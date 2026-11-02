import { isSlugCollision, newTestBody, slugify, uniqueSlug } from '../../../puck/editor/editor.model.js'
import type { DocId } from '../../../types/contracts.js'
import { NEW_TEST_COPY as C } from '../../copy/newTest.js'

export async function createTest(apiRoute: string, input: Omit<Parameters<typeof newTestBody>[0], 'slug'>): Promise<DocId> {
  const api = apiRoute.replace(/\/$/, '')
  const base = slugify(input.name) || 'test'
  for (let attempt = 0; ; attempt++) {
    // Suffixes shorten a 64-character base; include those neighbouring slugs in the lookup.
    const lookup = await fetch(`${api}/xp-experiments?where[slug][like]=${encodeURIComponent(base.slice(0, 60))}&depth=0&limit=200&select[slug]=true`, { credentials: 'include' })
    const found = await lookup.json()
    if (!lookup.ok || !Array.isArray(found?.docs)) throw new Error(C.createError)
    const taken = found.docs.flatMap((doc: { slug?: unknown }) => typeof doc.slug === 'string' ? [doc.slug] : [])
    const response = await fetch(`${api}/xp-experiments`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTestBody({ ...input, slug: uniqueSlug(base, taken) })),
    })
    const body = await response.json()
    if (attempt === 0 && isSlugCollision(response.status, body)) continue
    if (!response.ok) throw new Error(typeof body?.errors?.[0]?.message === 'string' ? body.errors[0].message : C.createError)
    if (typeof body?.doc?.id !== 'string' && typeof body?.doc?.id !== 'number') throw new Error(C.createError)
    return body.doc.id
  }
}
