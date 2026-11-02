import type { InitPageResult } from 'payload'
import { fakeReq } from '../../_fakes/req.js'

export function fakeInitPageResult(overrides: Partial<InitPageResult> = {}) {
  return {
    cookies: new Map<string, string>(),
    languageOptions: [],
    permissions: {},
    req: fakeReq(),
    translations: {},
    visibleEntities: { collections: [], globals: [] },
    ...overrides,
  } satisfies InitPageResult
}
