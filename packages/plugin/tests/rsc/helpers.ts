import { vi } from 'vitest'
import type { Payload } from 'payload'
import type { Manifest, ManifestExperiment } from '../../src/types/manifest.js'
import { defineExperimentsProxyRuntime } from '../../src/runtime/proxyRuntime.js'
import { defineExperimentsServerRuntime } from '../../src/server/serverRuntime.js'
import { assign } from '../../src/runtime/assign.js'
import { rememberManifest } from '../../src/server/context.js'
import type { ExperimentsProxyRuntimeOptions, ExperimentsServerRuntimeOptions } from '../../src/types/runtime.js'

export const secrets = ['current', 'old']
export const experiment = (patch: Partial<ManifestExperiment> = {}): ManifestExperiment => ({
  id: 7, slug: 'hero', kind: 'block', unitType: 'visitor', status: 'running', phase: 1,
  phaseKind: 'test', seed: '0123456789abcdef0123456789abcdef|', coverage: 1,
  arms: [{ key: 'control', kind: 'control', weight: 0, slot: 'control', params: { text: 'original' } }, { key: 'variantA', kind: 'variant', weight: 100, slot: 'variantA', params: { text: 'winner' } }],
  targeting: [], exposurePolicy: 'render', deferrable: false, ...patch,
})
export const page = (patch: Partial<ManifestExperiment> = {}) => experiment({ kind: 'page', exposurePolicy: 'pageview', arms: [
  { key: 'control', kind: 'control', weight: 0, pageTarget: '/original' },
  { key: 'variantA', kind: 'variant', weight: 100, pageTarget: '/variant' },
], ...patch })
export const manifest = (experiments = [experiment()]): Manifest => ({ v: 1, revision: 3, experiments, flagDefaults: {}, archivedWinners: { archived: 'variantB' }, archivedPages: {} })
export function runtime(m = manifest(), proxy: Partial<ExperimentsProxyRuntimeOptions> = {}, server: Partial<ExperimentsServerRuntimeOptions> = {}, custom = {}) {
  const payload = { config: { custom: { xp: custom } }, findByID: vi.fn() } as unknown as Payload
  const loadManifest = vi.fn(async () => m)
  const rt = defineExperimentsServerRuntime(defineExperimentsProxyRuntime({ secret: secrets, apiRoute: '/api', loadManifest, ...proxy }), { getPayload: vi.fn(async () => payload), ...server })
  return { rt, loadManifest, payload }
}
export function assignments(m = manifest()) {
  const a = assign(m, { visitorId: 'visitor', userId: 'private-user' }, {}, { now: 1_800_000_000 })
  rememberManifest(a, m)
  return a
}
