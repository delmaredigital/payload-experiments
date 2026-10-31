import { vi } from 'vitest'
import type { ClientAssignments } from '../../src/types/assignments.js'
import type { EventBody } from '../../src/types/endpoints.js'

export function assignments(overrides: Partial<ClientAssignments> = {}): ClientAssignments {
  return {
    v: 1, revision: 1, apiRoute: '/custom-api', pageviews: [],
    flagPoints: {
      signup: { arm: 'control', params: { label: 'Sign up' }, source: 'experiment', experiment: 'signup-test', experimentId: 42, phase: 1, policy: 'manual', exposable: true },
      defaults: { arm: 'control', params: { label: 'Default' }, source: 'default', exposable: false },
    },
    experiments: { 'signup-test': { arm: 'control', params: { label: 'Sign up' }, experimentId: 42, phase: 1, policy: 'manual', exposable: true } },
    ...overrides,
  }
}

export function transport() {
  const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true)
  const fetch = vi.fn(() => Promise.resolve())
  vi.stubGlobal('navigator', { sendBeacon })
  vi.stubGlobal('fetch', fetch)
  return { sendBeacon, fetch }
}

export async function bodyOf(blob: Blob): Promise<EventBody> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(JSON.parse(String(reader.result)) as EventBody)
    reader.onerror = reject
    reader.readAsText(blob)
  })
}
