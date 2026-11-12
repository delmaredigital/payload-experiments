export const API_MESSAGES = {
  testAlreadyDeleted: 'This test was already deleted. Reload the page.',
  testNoLongerDraft: 'This test is no longer a draft. Reload the page.',
  notFound: 'This test no longer exists.',
  goalNotFound: 'That goal no longer exists. Choose another goal.',
  roundChanged: 'This round has changed. Reload the page.',
  roundNotFound: 'That round no longer exists. Choose another round.',
  commitUnverified: 'The change may not have been saved. Reload and try again.',
  notImplemented: "This isn't available yet.",
  unauthenticated: 'Your session has expired. Sign in again.',
  forbidden: "You don't have permission to do this.",
  network: "Couldn't reach the server. Check your connection and try again.",
  failed: "Couldn't complete this change. Try again.",
  unreadable: "Couldn't read the server's response. Reload and try again.",
} as const

export const LOCKED_MESSAGES = {
  creation: 'Set when the test was created.',
  running: 'Locked while the test is running so everyone in this round sees the same thing. Stop the test to change it.',
  runningAllocation: 'To include more people, use "Let more people in" at the bottom of the page. To include fewer, stop the test; the change applies when you start it again.',
  runningMetrics: 'Add a guardrail or something to watch with "Add a goal" at the bottom of the page; the main goal is fixed for this round.',
  decided: 'Locked after the decision.',
  archived: "Archived tests can't be changed.",
  other: "Can't be changed in this state.",
} as const

export function refusalMessage(code: string | undefined, status: number, message?: string, options?: { notFound?: string; forbidden?: string; codes?: Readonly<Record<string, string>>; fallback?: string }): string {
  // A per-call code wins over the status branches: entry-not-found is a 404 that is not "this test no longer exists".
  const mapped = code && options?.codes && Object.hasOwn(options.codes, code) ? options.codes[code] : undefined
  if (mapped !== undefined) return mapped
  if (code === 'unauthenticated' || status === 401) return API_MESSAGES.unauthenticated
  if (code === 'not-found' || status === 404) return options?.notFound ?? API_MESSAGES.notFound
  if (code === 'commit-unverified') return API_MESSAGES.commitUnverified
  if (code === 'not-implemented' || status === 501) return API_MESSAGES.notImplemented
  if (code === 'forbidden' || status === 403) return options?.forbidden ?? API_MESSAGES.forbidden
  return options?.fallback ?? (message || API_MESSAGES.failed)
}
