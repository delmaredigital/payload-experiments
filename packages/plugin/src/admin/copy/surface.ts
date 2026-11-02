export const SURFACE_COPY = {
  title: 'Tests', newTest: 'New test', goals: 'Goals', search: 'Search tests',
  noAccess: "You don't have access to tests.",
  loading: 'Loading tests…', loadError: 'Tests could not be loaded. Please try again.',
  summaryError: 'Some test summaries could not be loaded. Please try again.', retry: 'Try again',
  empty: 'Test a change to see what works best for the people who visit your pages.',
  noMatches: 'No tests match your search.',
  groups: ['Needs attention', 'Running', 'Ready to start', 'Draft', 'Decided', 'Archived'],
  kinds: { block: 'Page block', flag: 'Setting', code: 'Setting', page: 'Whole page' },
  ready: 'Ready to start', next: 'Next: finish setting up',
  continue: 'Continue setup', results: 'View results', open: 'Open',
  health: { red: 'Stop and check', amber: 'Check data', green: 'On track' },
  newPlaceholder: 'New test setup is coming soon.',
  testPlaceholder: 'Test setup is coming soon.', resultsPlaceholder: 'Test results are coming soon.',
} as const

export function runningLine(days: string, planned: string, people: string) {
  return `Running ${days} days of ${planned} · ${people} people so far`
}
export function decidedLine(date: string, winner: string) { return `Decided ${date}: ${winner}` }
