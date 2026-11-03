export const PLACEMENT_FAILURE_COPY = {
  'placements-failed': "Couldn't check where this test is used. Try again.",
  forbidden: "You don't have permission to check where this test is used.",
  'not-found': "A page used by this test no longer exists. Choose another page.",
} as const

export const READINESS_COPY = {
  label: 'Readiness', addGoal: 'Add a goal',
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
  noTargets: 'Add a page address for each version.',
  pageVisitors: 'Whole-page tests count visitors. Create the test again counting visitors.',
  ruleFallback: 'check the value', versionFallback: 'check the group settings',
  groupFallback: 'each version', parameterFallback: 'each setting', attributeFallback: 'this attribute',
} as const

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
