import type { ContentReportReason } from '../../types/reasons.js'

export const ACTIONS_COPY = {
  start: 'Start', restart: 'Start a new round', stop: 'Stop', decide: 'Decide',
  release: 'Release holdout', makeContent: 'Make it the content', finish: 'Finish archiving',
  archive: 'Archive', discard: 'Discard winner',
  startBody: 'Start this experiment?',
  restartBody: 'Starting again begins a new round; results restart.',
  stopBody: 'Everyone will see the Original. Starting again begins a new round; results restart.',
  original: 'Everyone will see the Original.',
  discardBody: 'Everyone goes back to the Original. The decision note is kept.',
  archiveBody: 'Archive this experiment?', finishBody: 'The content has been updated. Finish archiving this experiment.',
  noResults: 'There are no results yet.', noRecommendation: "The results don't recommend a group yet.",
  different: 'You chose a different group than the results recommend.',
  group: 'Group', note: 'Decision note', confirmation: 'Confirmation',
  typePhrase: 'Type the following to confirm:', cancel: 'Cancel', retry: 'Retry', done: 'Done',
  loading: 'Loading results…', updated: 'Updated', failed: 'Failed',
  contentReasons: {
    localized: "This page has more than one language; Make it the content can't publish it safely yet. Copy the winning version by hand.",
    locked: 'Someone is editing this page. Wait for them to finish, then retry.',
    forbidden: "You can't read or update this page. Ask someone with access to update it by hand. If it was deleted, discard the winner to archive this test.",
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
  ? `Saves ${winner}'s settings as the new defaults so the experiment can be archived.`
  : `Copies ${winner} into the page content so the experiment can be archived.`
export const hardCodedLabel = (winner: string) => `The developer has hard-coded ${winner}`

/** Old reports can contain host error text: never interpolate an unknown string. */
export const contentReportCopy = (reason: string | undefined, ok = false) => reason === 'not-found' && ok ? ACTIONS_COPY.missingContent
  : ACTIONS_COPY.contentReasons[reason !== undefined && Object.hasOwn(ACTIONS_COPY.contentReasons, reason) ? reason as ContentReportReason : 'update-failed']
