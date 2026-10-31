export const API_MESSAGES = {
  notFound: 'This experiment no longer exists.',
  commitUnverified: 'The change may not have been saved. Reload and try again.',
  notImplemented: "This isn't available yet.",
  unauthenticated: 'Your session has expired. Sign in again.',
  forbidden: "You don't have permission to do this.",
  network: "Couldn't reach the server. Check your connection and try again.",
  failed: "Couldn't complete this change. Try again.",
  unreadable: "Couldn't read the server's response. Reload and try again.",
} as const

export const LOCKED_MESSAGES = {
  creation: 'Set when the experiment was created.',
  running: 'Locked while the test is running so everyone in this round sees the same thing. Stop the test to change it.',
  runningAllocation: 'Raise it from the actions panel; lowering takes effect in the next round.',
  runningMetrics: 'Add supporting metrics or guardrails from the actions panel; the main metric is fixed for this round.',
  decided: 'Locked after the decision.',
  archived: "Archived experiments can't be changed.",
  other: "Can't be changed in this state.",
} as const

export function refusalMessage(code: string | undefined, status: number, message?: string): string {
  if (code === 'unauthenticated' || status === 401) return API_MESSAGES.unauthenticated
  if (code === 'not-found' || status === 404) return API_MESSAGES.notFound
  if (code === 'commit-unverified') return API_MESSAGES.commitUnverified
  if (code === 'not-implemented' || status === 501) return API_MESSAGES.notImplemented
  if (code === 'forbidden' || status === 403) return API_MESSAGES.forbidden
  return message || API_MESSAGES.failed
}
