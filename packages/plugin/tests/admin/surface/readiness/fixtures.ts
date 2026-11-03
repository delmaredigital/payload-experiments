import { vi } from 'vitest'
import type { SectionProps, TestDocApi } from '../../../../src/admin/surface/contracts.js'
import type { TestDocument } from '../../../../src/admin/surface/testDocument.model.js'
import type { PreflightResult } from '../../../../src/types/endpoints.js'

export const doc: TestDocument = {
  id: 'xp1', name: 'Headline', slug: 'headline', kind: 'block', status: 'draft', unitType: 'visitor', allocation: 40, exposurePolicy: 'render',
  arms: [{ key: 'control', kind: 'control', label: 'Original', weight: 50, slot: 'control' },
    { key: 'variantA', kind: 'variant', label: 'Short headline', weight: 50, slot: 'variantA' }],
  analysis: { plannedDurationDays: 28 }, metrics: { primary: 1, secondary: [2], guardrails: [3] },
}
export const preflight = (checks: PreflightResult['checks'] = []): PreflightResult => ({ checks, placements: [], baseline: null, trafficPerDay: null, estimate: null })
export function props(document: Partial<TestDocument> = {}, test: Partial<TestDocApi> = {}): SectionProps {
  return {
    test: { doc: { ...doc, ...document }, preflight: preflight(), preflightError: null, preflightPending: false, hasUnsaved: false, stale: false, saving: 'idle', loadState: 'ready', errors: {},
      stage: vi.fn(), commit: vi.fn(async () => {}), reload: vi.fn(async () => {}), refreshPreflight: vi.fn(async () => {}), ...test },
    surface: { apiRoute: '/custom-api', adminRoute: '/admin', canManage: true, canReadResults: false, isAdmin: true, flagPoints: [], metricSources: [], attributeKeys: {} },
  }
}
