export const PLACEMENT_FAILURE_COPY = {
  'placements-failed': "Couldn't check where this test is used. Try again.",
  forbidden: "You don't have permission to check where this test is used.",
  'not-found': "A page used by this test no longer exists. Choose another page.",
} as const

export const SAVE_PAGE = 'Save this page to put the test on it.'
export const PUBLISH_PAGE = 'Publish this page to start the test.'
export const RUNNING_PUBLISH_PAGE = "This test is running, but visitors won't see it here until this page is published."
export const RUNNING_SAVE_PAGE = "This test is running, but visitors won't see it here until this page is saved and published."

export const READINESS_COPY = {
  beforeStart: 'Before you can start:',
  label: 'Readiness', addGoal: 'Add a goal',
  needsAttention: 'Needs attention', needsAttentionPrefix: 'Needs attention: ',
  missingVersions: 'This test is missing its saved versions. Open the test and check its setup before changing this page.',
  saveGeneralError: "Couldn't save. Reload to check the saved test.",
  changing: 'Saving this change…', reloadAfterError: "Couldn't save the test. Reload to check its saved settings before starting.",
  chooseGoalToAdd: 'Choose a goal to add it to this test.',
  reloadFirst: 'Reload to see the latest test settings before starting.',
  ready: 'Ready to start.', saveFirst: 'Wait for your changes to save.',
  saving: 'Saving…', saved: 'Saved', saveError: "Couldn't save — see the highlighted field",
  checkError: "Couldn't check readiness. Try again.", checking: 'Checking readiness…', retry: 'Try again',
  archived: 'Archived.', running: 'Running', stopped: 'Stopped', decided: 'Decided',
  addMetric: 'Add a guardrail or something to watch', allocate: 'Let more people in',
  everyone: 'Everyone already takes part.',
  participation: 'How many people take part (%)',
  noPlacements: 'Not on a page yet. Open a page, add an Experiment block and choose this test.',
  placementRemoved: "The block for this test was removed from its page, so it can't start again. Its results are kept. To test the block again, start a new test from the page.",
  noPoint: 'Choose the setting to test.',
  busy: 'Another test is already running on this setting. Stop it first.',
  noGoal: 'Choose a goal.', unknownGoal: "This goal's data source isn't available. Choose another goal.",
  noDuration: 'Choose how long to run it.', noReach: 'Enter how many people reach this per day.',
  full: "This test's group is full. Lower how many people take part, or create the test again without the group.",
  differentPeople: "This test's group counts different people. Create the test again without the group.",
  uncheckedPages: "Version pages aren't checked; make sure each one is published.",
  chooseDifferentPage: 'Choose a different page', choosePages: 'Choose pages',
  noTargets: 'Choose a page for each version.',
  pageVisitors: 'Whole-page tests count visitors. Create the test again counting visitors.',
  blockPathRule: 'Remove the page-path rule in Who takes part; page block tests run on their page.',
  // Next steps repeat the button label verbatim (testPage.ts removeRule).
  removeRule: 'Remove rule',
  ruleFallback: 'check the value', versionFallback: 'check the group settings',
  groupFallback: 'each version', parameterFallback: 'each setting', attributeFallback: 'this attribute',
} as const

export const unsupportedContentCopy = (page: string) => `${page} has more than one language, so Make it the content isn't available for it; you'll copy the winning version by hand.`
export const pageInUseCopy = (path: string, version = false) => version
  ? `${path} is already in another running or decided test. Make a new copy of the Original for this version, or finish that test first.`
  : `Another running or decided test already uses ${path}. Choose a different page, or finish that test first.`
export const unpublishedPageCopy = (path: string, context?: { original: boolean; found: boolean; collection: string }) => !context
  ? `${path} isn't a published page yet. Publish it, or choose another page.`
  : context.original ? `${path} isn't published, so it can't be the Original. Publish it, or choose another page.`
    : context.found ? `${path} is still a draft. Publish it in ${context.collection}, then start the test.`
      : `${path} isn't published yet, or no page has that address. Publish it in ${context.collection}, or choose another page.`
/** Old responses may include raw host errors; unknown strings use authored copy. */
export const placementFailureCopy = (reason: unknown) => PLACEMENT_FAILURE_COPY[typeof reason === 'string' && Object.hasOwn(PLACEMENT_FAILURE_COPY, reason) ? reason as keyof typeof PLACEMENT_FAILURE_COPY : 'placements-failed']

const withoutPeriod = (value: string) => value.trim().replace(/[.!?]+$/, '')
export const fixFieldsNext = (name: string) => `Fix the highlighted fields in ${name}.`
export const nextCopy = (sentence: string) => `Next: ${sentence}`
export const versionsNext = (detail: string) => `Fix the versions: ${withoutPeriod(detail)}.`
export const contentNext = (group: string) => `Add content for ${group} on the page.`
export const parameterNext = (parameter: string, group: string) => `Set a value for ${parameter} on ${group}.`
export const placementNext = (group: string, detail: string) => `Add content for ${group} wherever this setting is used${detail.trim() ? `: ${withoutPeriod(detail)}` : ''}.`
export const goalPeopleNext = (people: string) => `This goal can't be measured for ${people}. Choose another goal.`
export const ruleNext = (detail: string) => `Fix the rule: ${withoutPeriod(detail)}.`
export const attributeNext = (attribute: string) => `Remove the rule on ${attribute}: it isn't available.`
export const stoppedCopy = (date: string | null) => `Stopped${date ? ` ${date}` : ''}. Edit the versions, goal, audience or length below, then start again (results restart).`
export const decidedCopy = (date: string | null, winner: string) => `Decided${date ? ` ${date}` : ''}: ${winner}.`
export const runningCopy = (date: string | null, people: number | null, days: number | null) => [
  date ? `Running since ${date}` : READINESS_COPY.running,
  people === null ? null : `${people.toLocaleString('en-US')} people so far`,
  days === null ? null : `about ${days} days to go`,
].filter(Boolean).join(' · ')

export const lastBlockPlacementCopy = (name: string, removingPage = false) => removingPage
  ? `“${name}” is running and this page is the only published place it appears. Stop the test first.`
  : `“${name}” is running and this is the only published place it appears. Stop the test, or keep its block on this page.`

export const bulkBlockRemovalCopy = (name: string) => `“${name}” is running and the pages in this change are the only published places it appears. Stop the test first.`

export const pendingBlockRemovalCopy = (name: string) => `“${name}” is running and the pages in this change are the only published places it appears. Stop the test first, or change these pages one at a time.`

/** After archive the guard protects the winner and the Original; only the winner page is "the winner". */
export const pageGuardCopy = (name: string, status: 'running' | 'decided' | 'archived', role: 'winner' | 'original' = 'winner') => status === 'archived'
  ? role === 'original'
    ? `This page's address now shows the winner of the finished test "${name}". To free it, open the test and choose "Release pages".`
    : `This page is shown at other addresses because the finished test "${name}" made it the winner. To free it, open the test and choose "Release pages".`
  : status === 'decided'
    ? `This page is part of the decided test "${name}". Choose "Make it the content" or "Discard winner" on the test before you delete, rename or unpublish it.`
    : `This page is part of the running test "${name}". Stop the test before you delete, rename or unpublish it.`
export const versionPageUnavailableCopy = (path: string, status = 'running') => `${path} isn't published, so visitors assigned to it see an error. Republish it, or ${status === 'decided' ? 'discard the winner' : 'stop the test'}.`
export const versionPageUncheckedCopy = (path: string, status = 'running') => `Couldn't check whether ${path} is published. Check that it is still published, or ${status === 'decided' ? 'discard the winner' : 'stop the test'}.`

export const sameAddressCopy = (label: string, other: string, path: string, collection?: string) => `${label} has the same address (${path}) as ${other}. Choose a different page.${collection ? ` Give the copy its own address in ${collection}, publish it, then choose it.` : ''}`
export const identicalVersionCopy = (version: string) => `${version} looks the same as the Original, so the test would compare nothing. Change it before you start.`

/** Keep named actions aligned with the actual transition buttons. */
export function placementGuardCopy(page: { name: string; status: string }, block: { name: string; status: string }, preExisting: boolean): string {
  const action = (test: { name: string; status: string }) => test.status === 'running' ? `stop ${test.name}` : `choose "Make it the content" or "Discard winner" on ${test.name}`
  return preExisting
    ? `This page is in two tests that change it, ${page.name} and ${block.name}. Before you publish, ${action(page)} or ${action(block)}.`
    : `This page is part of the ${page.status} test ${page.name}, so a block from another test can't be added to it. Finish one of the tests first.`
}

export function interactingTestsCopy(page: string, state: string, name: string, version = false): string {
  return `This test uses ${page}, which the ${state} test ${name} also changes. Finish one of them first${version ? `, or remove its block from ${page}` : ''}.`
}

export const goalInSomeVersionsCopy = (name = 'This goal') => `${name} appears in some versions but not all, so the comparison wouldn't be fair. Add it to every version, or choose another goal.`
export function asymmetricGoalsCopy(detail: unknown): string {
  return (Array.isArray(detail) && detail.length ? detail : [detail]).map(item => {
    const name = item && typeof item === 'object' && 'name' in item ? item.name : undefined
    return goalInSomeVersionsCopy(typeof name === 'string' && name.trim() ? name.trim() : undefined)
  }).join('\n')
}
export const placementUncheckedCopy = (page: string) => `${page} couldn't be checked, so the test can't confirm every version shows the same goals. Check that you can open it.`

export const moreBlockers = (count: number) => `and ${count} more`

export const unpublishedPlacementsCopy = (detail?: unknown) => (Array.isArray(detail) && detail.length ? detail : [detail]).map(placement => {
  const title = placement && typeof placement === 'object' && typeof placement.title === 'string' && placement.title.trim() ? placement.title.trim() : 'this page'
  return unpublishedPlacementCopy(title)
}).join('\n')
export const unpublishedPlacementCopy = (title = 'this page') => `The block you're testing is only on a draft of ${title}. Publish the page before you start.`
