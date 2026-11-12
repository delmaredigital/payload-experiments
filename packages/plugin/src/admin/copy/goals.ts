import { CLICK_GOAL_COPY } from '../../goals/picker/copy.js'
export const GOALS_COPY = {
  slugRule: CLICK_GOAL_COPY.slugRule, duplicateSlug: CLICK_GOAL_COPY.duplicateSlug,
  duplicateSlugMain: 'Another goal already uses this short name. Choose another.',
  title: 'Goals', goal: 'Goal', newGoal: 'New goal', name: 'Name', source: 'Measured by', directionColumn: 'Better when',
  direction: 'Better when it goes', increase: 'More is better', decrease: 'Less is better', usedBy: 'Used by', status: 'Status',
  showLess: 'Show less',
  inUse: 'In use', unused: 'Not used yet', empty: 'No goals yet. A goal is what a test tries to improve.',
  loading: 'Loading goals…', loadError: "Couldn't load goals. Try again.", retry: 'Try again',
  slug: 'Short name', slugHelp: 'A unique short name for this goal.', slugLocked: 'The short name stays the same once a test uses this goal.',
  sourceLocked: 'What this goal measures stays the same once a test uses it.',
  chooseSource: 'Choose an outcome', window: 'Count results for (hours)', minimum: 'Minimum completions before deciding',
  advanced: 'Advanced', capping: 'Limit very large values', capType: 'Limit by', capValue: 'Limit value',
  noCap: 'No limit', percentile: 'Based on past amounts', absolute: 'Fixed amount',
  capHelp: 'For past amounts, enter a number such as 0.99 to limit only the largest 1%; or enter a fixed amount.',
  threshold: 'Warn when it gets worse by (%)', save: 'Save', saving: 'Saving…', cancel: 'Cancel', remove: 'Delete goal',
  thresholdError: 'Enter a percentage of zero or more, or leave blank for 5%.',
  deleting: 'Deleting…', saveError: CLICK_GOAL_COPY.saveError, deleteError: "Couldn't delete the goal. Try again.",
  breadcrumb: 'Breadcrumb', missing: 'This goal no longer exists.', notFound: 'This goal no longer exists.',
  backToTest: 'Back to the test', useGoal: 'Use this goal', open: 'Open', search: 'Search goals', clearSearch: 'Clear search',
  fields: 'Goal details', deleteTitle: 'Delete this goal?', deleteBody: 'This cannot be undone.', confirmDelete: 'Delete',
  thoseTests: 'those tests', deleteLockedEnd: ' first.',
} as const

export function goalUsedBy(count: number) { return `Used by ${count} ${count === 1 ? 'test' : 'tests'}` }

export function goalInUse(count: number) { return `In use by ${count} ${count === 1 ? 'test' : 'tests'}` }
export function goalDeleteLockedStart(count: number) { return `${goalUsedBy(count)}. Remove it from ` }
export function goalsNoMatches(search: string) { return `No goals match “${search}”.` }

export function goalShowAll(count: number) { return `Show all ${count}` }
