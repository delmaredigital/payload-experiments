import { ARM_LABELS } from '../../labels/arms.js'

export const editorCopy = {
  labels: ARM_LABELS,
  notSetUp: 'Not set up',
  unbound: 'Choose or create a test to show different versions.',
  draft: 'This block shows the Original to everyone until the test starts.',
  running: 'Changing this content mid-test mixes two versions in one result',
  decided: (winner: string) => `Decided: ${winner}. Use 'Make it the content' on the test to finish.`,
  archived: 'This test is archived; the winning content is shown to everyone.',
  copy: 'Copy Original here',
  dropZone: (slot: 'control' | 'variantA' | 'variantB' | 'variantC') => slot === 'control'
    ? 'Drop the original content here'
    : `Drop ${editorCopy.labels[slot]} content here`,
  replaceConfirm: (label: string) => `${label} already has content. Replace it with a copy of the Original?`,
  replace: 'Replace',
  createLabel: 'Test this block',
  creating: 'Creating…',
  cancel: 'Cancel',
  name: 'Name',
  setup: 'Set up the test',
  viewResults: 'View results',
  nameExists: "This name is too close to an existing test. Choose a different name.",
  createError: "Couldn't create the test. Try again.",
  loading: 'Loading test…',
  loadError: "Couldn't load this test. Try selecting it again.",
  orphan: (label: string) => `${label} has content but isn't part of this test. Move or delete it; visitors never see it.`,
  tabs: 'Test versions',
  add: 'Add variant',
  menu: (label: string) => `Options for ${label}`,
  rename: 'Rename',
  renameLabel: 'Version name',
  emptyLabel: 'Enter a name for this version.',
  remove: 'Remove',
  removeTitle: (label: string) => `Remove ${label}?`,
  removeHelp: 'This removes the version from the test and clears its content from this page.',
  removed: "Save the page to finish removing this version's content.",
  weight: (label: string) => `${label} traffic (%)`,
  split: 'Split evenly',
  locked: {
    running: "This test is running, so its versions can't change. Stop it on the test page to edit them.",
    decided: "This test has a decision, so its versions can't change. View the results on the test page.",
    archived: "This test is archived, so its versions can't change. View the results on the test page.",
  },
  staleEdit: 'Someone else changed this test. Reload to see their changes.',
  writeError: "Couldn't complete this change. Try again.",
  writeNetwork: "Couldn't reach the server. Check your connection and try again.",
  writeUnreadable: "Couldn't read the server's response. Reload and try again.",
  collecting: 'Collecting',
  resultsUnavailable: "Results aren't available here.",
  refresh: 'Refresh',
  people: (label: string, count: string) => `${label}: ${count} people`,
} as const

// Minimal editor-side equivalent of admin/copy/common.ts: the editor graph cannot import admin.
// Never accept server text as a fallback.
export function writeRefusal(code: string | undefined, status: number): string {
  if (code === 'stale-edit') return editorCopy.staleEdit
  if (code === 'unauthenticated' || status === 401) return 'Your session has expired. Sign in again.'
  if (code === 'not-found' || status === 404) return 'This test no longer exists.'
  if (code === 'commit-unverified') return 'The change may not have been saved. Reload and try again.'
  if (code === 'not-implemented' || status === 501) return "This isn't available yet."
  if (code === 'forbidden' || status === 403) return "You don't have permission to do this."
  return editorCopy.writeError
}
