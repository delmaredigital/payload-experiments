export const GOALS_COPY = {
  title: 'Goals', newGoal: 'New goal', name: 'Name', source: 'Measured by', directionColumn: 'Better when',
  direction: 'Better when it goes', increase: 'Goes up', decrease: 'Goes down', usedBy: 'Used by', status: 'Status',
  inUse: 'In use', unused: 'Not used', empty: 'A goal is an outcome you want a test to improve, such as a registration or a gift.',
  loading: 'Loading goals…', loadError: "Couldn't load goals. Try again.", retry: 'Try again',
  slug: 'Short name', slugHelp: 'A unique short name for this goal.', slugLocked: 'The short name stays the same once a test uses this goal.',
  chooseSource: 'Choose an outcome', window: 'Count results for (hours)', minimum: 'Minimum completions before deciding',
  advanced: 'Advanced', capping: 'Limit very large values', capType: 'Limit by', capValue: 'Limit value',
  noCap: 'No limit', percentile: 'Based on past amounts', absolute: 'Fixed amount',
  capHelp: 'For past amounts, enter a number such as 0.99 to limit only the largest 1%; or enter a fixed amount.',
  threshold: 'Warn when it gets worse by (%)', save: 'Save', saving: 'Saving…', cancel: 'Cancel', remove: 'Delete',
  deleting: 'Deleting…', saveError: "Couldn't save the goal. Try again.", deleteError: "Couldn't delete the goal. Try again.",
  breadcrumb: 'Breadcrumb', missing: 'This goal could not be found.',
} as const

export function goalUsedBy(count: number) { return `Used by ${count} tests` }
