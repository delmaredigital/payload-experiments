import type { AddMetricWarning } from '../../types/endpoints.js'
import { asymmetricGoalsCopy } from './readiness.js'
import type { ContentReportReason } from '../../types/reasons.js'

export const ACTIONS_COPY = {
  start: 'Start', restart: 'Start a new round', stop: 'Stop', decide: 'Decide',
  release: 'Release holdout', makeContent: 'Make it the content', finish: 'Finish archiving',
  archive: 'Archive', discard: 'Discard winner',
  startBody: 'Start this test?',
  restartBody: 'Starting again begins a new round; results restart.',
  stopBody: 'Everyone will see the Original. Starting again begins a new round; results restart.',
  original: 'Everyone will see the Original.',
  discardBody: 'Everyone goes back to the Original. The decision note is kept.',
  archiveBody: 'Archive this test?', finishBody: 'The content has been updated. Finish archiving this test.',
  noResults: 'There are no results yet.', noRecommendation: "The results don't recommend a group yet.",
  different: 'You chose a different group than the results recommend.',
  group: 'Group', note: 'Decision note', confirmation: 'Confirmation',
  typePhrase: 'Type the following to confirm:', cancel: 'Cancel', retry: 'Retry', done: 'Done',
  dismiss: 'Dismiss', dismissed: 'Dismissed', undo: 'Undo',
  contentArchived: 'The winner is now the content and the test is archived.',
  dismissLabel: (page: string) => `Dismiss ${page}`, undoLabel: (page: string) => `Undo dismiss ${page}`,
  dismissHelp: "Dismiss a page you'll update by hand, then finish archiving.",
  contentEntryNotDecided: "This test isn't decided, so its pages can't be changed.",
  contentEntryMissing: 'This page is no longer in the list. Reload to see the current list.',
  contentEntryDismissed: 'This page was already dismissed.',
  contentEntryNotDismissed: "This page isn't dismissed. Reload to see its current state.",
  contentEntryUpdated: 'This page is already updated.',
  contentEntryNotFound: 'This test no longer exists.',
  contentEntryFallback: "This page can't be changed right now. Reload to see its current state.",
  loading: 'Loading results…', updated: 'Updated', failed: 'Failed',
  contentReasons: {
    localized: "This page has more than one language; Make it the content can't publish it safely yet. Copy the winning version by hand.",
    locked: 'Someone is editing this page. Wait for them to finish, then retry.',
    forbidden: "You can't read or update this page. Ask someone with access to update it by hand. If it was deleted or moved to trash, discard the winner to archive this test.",
    'not-found': 'This page could not be found. Check whether it was deleted.',
    validation: "This page couldn't be saved automatically. Update it by hand, then retry.",
    'update-failed': "This page couldn't be updated this time. Retry; if it keeps happening, ask a developer.",
  } satisfies Record<ContentReportReason, string>,
  missingContent: 'This page no longer exists; nothing to change.',
  partial: "Some pages couldn't be updated. Fix them and retry.",
} as const

export const decideCopy = (winner: string, holdout: boolean, original: boolean) => original ? ACTIONS_COPY.original
  : holdout ? `Everyone except the holdout will see ${winner}. The holdout keeps seeing the Original so we can measure the shipped change.`
    : `Everyone will see ${winner}.`
export const releaseCopy = (winner: string) => `The holdout will see ${winner} too. Measuring since shipping ends.`
export const makeContentCopy = (winner: string, kind: 'block' | 'page' | 'flag') => kind === 'flag'
  ? `Saves ${winner}'s settings as the new defaults so the test can be archived.`
  : `Copies ${winner} into the page content so the test can be archived.`
export const hardCodedLabel = (winner: string) => `The developer has hard-coded ${winner}`

/** Old reports can contain host error text: never interpolate an unknown string. */
export const contentReportCopy = (reason: string | undefined, ok = false) => reason === 'not-found' && ok ? ACTIONS_COPY.missingContent
  : ACTIONS_COPY.contentReasons[reason !== undefined && Object.hasOwn(ACTIONS_COPY.contentReasons, reason) ? reason as ContentReportReason : 'update-failed']

// Each dismiss/restore refusal code has its own sentence; server text is never shown.
export const CONTENT_ENTRY_REFUSALS = {
  notFound: ACTIONS_COPY.contentEntryNotFound,
  codes: {
    'not-decided': ACTIONS_COPY.contentEntryNotDecided,
    'entry-not-found': ACTIONS_COPY.contentEntryMissing,
    'entry-ok': ACTIONS_COPY.contentEntryUpdated,
    'entry-dismissed': ACTIONS_COPY.contentEntryDismissed,
    'entry-not-dismissed': ACTIONS_COPY.contentEntryNotDismissed,
  },
  fallback: ACTIONS_COPY.contentEntryFallback,
} as const

export const addMetricWarningCopy = (warning: AddMetricWarning) => warning.code === 'goal-added-mid-test'
  ? "Clicks before this goal was added aren't counted (the same for every version)."
  : asymmetricGoalsCopy(warning.detail)
