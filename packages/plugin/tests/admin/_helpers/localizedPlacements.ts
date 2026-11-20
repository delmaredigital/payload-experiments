import type { PreflightResult } from '../../../src/types/endpoints.js'

/** The publication/readiness split pinned by transitions/preflightData.test.ts. */
export const differingPlacements: PreflightResult['placements'] = [
  { collection: 'pages', id: 10, title: 'Home', detail: 'Published', locales: ['English'], slotCount: 1, ok: true, url: '/en/home', editorUrl: '/edit/en' },
  { collection: 'pages', id: 10, title: 'Accueil', detail: 'Published', locales: ['French'], slotCount: 3, ok: false, url: '/fr/accueil', editorUrl: '/edit/fr' },
  { collection: 'pages', id: 10, title: 'Home draft', detail: 'Draft', allLocales: true, slotCount: 1, ok: false, url: '/draft/home', editorUrl: '/edit/draft' },
]

export const localizedPlacements: PreflightResult['placements'] = differingPlacements.map(row => ({ ...row, title: 'Home', slotCount: 1 }))
