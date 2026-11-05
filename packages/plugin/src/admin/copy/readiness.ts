export const PLACEMENT_FAILURE_COPY = {
  'placements-failed': "Couldn't check where this test is used. Try again.",
  forbidden: "You don't have permission to check where this test is used.",
  'not-found': "A page used by this test no longer exists. Choose another page.",
} as const

export const READINESS_COPY = {
  label: 'Readiness', addGoal: 'Add a goal',
  needsAttention: 'Needs attention',
  missingVersions: 'This test is missing its saved versions. Open the test and check its setup before changing this page.',
  ready: 'Ready to start.', saveFirst: 'Save your changes first.',
  saving: 'Saving…', saved: 'Saved', saveError: "Couldn't save — see the highlighted field",
  checkError: "Couldn't check readiness. Try again.", checking: 'Checking readiness…', retry: 'Try again',
  archived: 'Archived.', running: 'Running', stopped: 'Stopped', decided: 'Decided',
  addMetric: 'Add a guardrail or something to watch', allocate: 'Let more people in',
  everyone: 'Everyone already takes part.',
  participation: 'How many people take part (%)',
  noPlacements: 'Not on a page yet. Open a page, add an Experiment block and choose this test.',
  noPoint: 'Choose the setting to test.',
  busy: 'Another test is already running on this setting. Stop it first.',
  noGoal: 'Choose a goal.', unknownGoal: "This goal's data source isn't available. Choose another goal.",
  noDuration: 'Choose how long to run it.', noReach: 'Enter how many people reach this per day.',
  full: "This test's group is full. Lower how many people take part, or create the test again without the group.",
  differentPeople: "This test's group counts different people. Create the test again without the group.",
  uncheckedPages: "Version pages aren't checked; make sure each one is published.",
  chooseDifferentPage: 'Choose a different page',
  noTargets: 'Choose a page for each version.',
  pageVisitors: 'Whole-page tests count visitors. Create the test again counting visitors.',
  blockPathRule: 'Remove the page-path rule in Who takes part; page block tests run on their page.',
  // Next steps repeat the button label verbatim (testPage.ts removeRule).
  removeRule: 'Remove rule',
  ruleFallback: 'check the value', versionFallback: 'check the group settings',
  groupFallback: 'each version', parameterFallback: 'each setting', attributeFallback: 'this attribute',
} as const

export const unsupportedContentCopy = (page: string) => `${page} has more than one language, so Make it the content isn't available for it; you'll copy the winning version by hand.`
export const pageInUseCopy = (path: string) => `Another running or decided test already uses ${path}. Choose a different page, or finish that test first.`
export const unpublishedPageCopy = (path: string) => `${path} isn't a published page. Publish it, or pick another page.`
/** Old responses may include raw host errors; unknown strings use authored copy. */
export const placementFailureCopy = (reason: unknown) => PLACEMENT_FAILURE_COPY[typeof reason === 'string' && Object.hasOwn(PLACEMENT_FAILURE_COPY, reason) ? reason as keyof typeof PLACEMENT_FAILURE_COPY : 'placements-failed']

const withoutPeriod = (value: string) => value.trim().replace(/[.!?]+$/, '')
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

export const sameAddressCopy = (label: string, other: string, path: string) => `${label} has the same address (${path}) as ${other}. Choose a different page.`
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
