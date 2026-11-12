const guardrailsShort = 'Must not get worse'
const secondaryShort = 'Also keep an eye on'

export const TEST_PAGE = {
  clickPageGroup: "On this test's page",
  clickGoalsNote: "Goals inside linked documents aren't shown. Goals added in code (data-xp-goal) work but aren't listed here.",
  clickGoalHelp: 'A click shows interest, not the result you want.',
  staleEdit: 'Someone else changed this test. Reload to see their changes.', reload: 'Reload',
  loading: 'Loading test…', forbidden: "You don't have access to this test.", missing: 'This test no longer exists.',
  error: "Couldn't load this test.", retry: 'Try again', name: 'Test name', results: 'Results',
  tests: 'Tests', test: 'Test', navigation: 'Sections', completePrefix: 'Complete: ', incompletePrefix: 'Incomplete: ',
  complete: 'Complete', incomplete: 'Incomplete', completeMark: '✓', incompleteMark: '○',
  kinds: { block: 'Page block', page: 'Whole page', flag: 'Setting', code: 'Setting' },
  sections: { what: "What you're testing", versions: 'Versions', win: 'What counts as a win', who: 'Who takes part (optional)', length: 'How long', advanced: 'Advanced settings · for developers' },
  hypothesis: 'Why are you testing this? (optional)', hypothesisPlaceholder: 'We believe … will … because …',
  notPlaced: 'Not on a page yet. Open a page, add an Experiment block and choose this test.',
  onPage: 'On:', openPage: 'Open the page', editedOnPage: 'Versions are edited on the page.', editOnPage: 'Edit on page',
  empty: 'Empty', pageReady: 'Page ready', addPageAddress: 'Add a page address',
  ready: 'Content ready', emptySlot: 'Nothing in this slot yet', pageBinding: 'Each version is a whole page at its own address.',
  pageAddress: 'Page address', holdoutContent: 'Sees the Original', label: 'Version label', weight: 'Share (%)',
  balanceHelp: 'Changing a share balances the other versions so the total stays at 100%.',
  addVersion: 'Add a version', addHoldout: 'Add a holdout', split: 'Split evenly', remove: 'Remove version',
  invalidShare: 'Use a whole number from 0 to 100.',
  holdoutPrefix: 'Holdout: ',
  allocation: 'How many people take part', traffic: 'How people are split',
  goal: 'Goal', goalHelp: 'The goal decides whether a version wins. Pick the one thing you want more of.',
  guardrailsShort, guardrails: `${guardrailsShort} (optional)`, guardrailHelp: "If a version makes one of these worse, you'll be warned.",
  secondaryShort, secondary: `${secondaryShort} (optional)`, manageGoals: 'Manage goals', searchGoals: 'Search goals', chooseGoal: 'Choose a goal',
  goalsError: "Couldn't load goals. Try again.", noGoal: 'None selected', missingGoal: 'A goal that no longer exists', goalUnavailable: 'Goal details unavailable',
  everyone: 'Everyone on the pages where this appears.', rulesSummary: 'Only people matching these rules.', addRule: 'Add a rule', removeRule: 'Remove rule',
  blockPathRule: 'This rule no longer applies to page block tests; remove it.',
  attribute: 'Attribute', comparison: 'Comparison', value: 'Value', yes: 'Yes', no: 'No',
  reach: 'About how many people will see this per day?', reachHelp: 'A rough number is fine. It only sets the suggested length.',
  duration: 'Planned length (days)', noSuggestion: 'Enter a daily number above to get a suggestion. 4 weeks is a safe default.',
  chooseGoalSuggestion: 'Choose a goal to get a suggestion.', required: '(required)',
  apply: 'Apply', infeasible: 'This may need more people than are available.',
} as const

export const suggestedWeeks = (weeks: number) => `Suggested: about ${Math.round(weeks * 10) / 10} weeks`
export const weeksHint = (days: number) => `About ${Math.round(days / 7 * 10) / 10} weeks`
export const NUMBER_COMPARISONS = { eq: 'is', neq: 'is not', gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most' } as const

export const placementCount = (count: number) => ` (placed ${count} times)`
