export const ACTIONS_COPY = {
  start: 'Start', restart: 'Start a new round', stop: 'Stop', decide: 'Decide',
  release: 'Release holdout', makeContent: 'Make it the content', finish: 'Finish archiving',
  archive: 'Archive', discard: 'Discard winner',
  deleteNoteArchived: "Deleting removes this experiment's records and results. A winner that was already made permanent stays in place.",
  deleteNoteDraft: 'Deleting removes this experiment and its settings.',
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
