export const BLOCK_COPY = {
  testBlock: 'Test a block on this page',
  pick: 'Choose a block',
  empty: 'There are no blocks on this page to test yet. Add one, save, then come back.',
  blockChanged: 'This block changed while you were working. Nothing was replaced. Try again.',
  replace: 'Replace',
  cancel: 'Cancel',
  retry: 'Try again',
  saveFirst: 'Save your changes, then try again.',
  setup: 'Set up the test',
  copy: 'Copy the Original into this version',
  confirmCopy: 'Replace this version’s content with a copy of the Original? Edits you made to this version will be lost.',
  unwrap: 'Unwrap',
  deleted: "This block's test was deleted; the page shows the Original.",
  discarded: 'This test has ended; the page shows the Original.',
  running: "Running: visitors see different versions. Edit a version's tab to change it; the change is noted on the results.",
  stopped: 'Stopped: visitors see the Original.',
  slotLabels: { control: 'Original', variantA: 'Variant A', variantB: 'Variant B', variantC: 'Variant C' } as Record<string, string>,
  wrapRefusals: {
    'wrap-target-missing': 'Reload the page and try again.',
    'locked-placement': 'Another editor has this page open. Try again when it is unlocked.',
    'invalid-status': 'This action is not available in the current status.',
    'unknown-collection': "That page type isn't set up for tests.",
    'invalid-body': 'Choose a block test.',
  } as Record<string, string>,
}
export const blockPosition = (label: string, position: number) => `${label} (block ${position})`
export const blockTestName = (title: string, label: string) => `${title}: ${label}`
export const blockDraftStatus = (name: string) => `This block is being tested in the draft test ${name}. Visitors see the Original until it starts.`
export const blockDecidedStatus = (winner: string, rollout: boolean) => `Decided: visitors see ${winner}${rollout ? '; a holdout still sees the Original' : ''}.`
export const blockFinishedStatus = (winner: string) => `Finished: visitors see ${winner}. Use "Make it the content" on the test to replace this block.`
export const blockSaveNotice = (drafts: boolean) => drafts ? 'Save a draft of this page to add the test.' : 'Save this page to add the test.'
export const blockSyncNotice = (drafts: boolean) => drafts ? 'Versions were updated to match the test. Save draft to keep them.' : 'Versions were updated to match the test. Save to keep them.'
