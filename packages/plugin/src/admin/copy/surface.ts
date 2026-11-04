export const SURFACE_COPY = {
  title: 'Tests', test: 'Test', resultsTitle: 'Results', newTest: 'New test', goals: 'Goals', search: 'Search tests',
  navAllTests: 'All tests', navGoals: 'Goals',
  dashShowTests: 'Show all tests', dashShowGoals: 'Show all goals',
  backToAdmin: 'Back to admin',
  limitedList: 'Showing the 200 most recent tests.',
  notInstalled: "The Tests screen isn't installed yet. Run `payload generate:importmap` and reload.",
  noAccess: "You don't have access to tests.",
  loading: 'Loading tests…', loadError: 'Tests could not be loaded. Please try again.',
  summaryError: 'Some test summaries could not be loaded. Please try again.', retry: 'Try again',
  empty: 'Create a test to learn what works.',
  clear: 'Clear',
  groups: ['Needs attention', 'Running', 'Ready to start', 'Draft', 'Decided', 'Archived'],
  kinds: { block: 'Page block', flag: 'Setting', code: 'Setting', page: 'Whole page' },
  ready: 'Ready to start', next: 'Review setup',
  continue: 'Continue setup', results: 'View results', open: 'Open',
  health: { red: 'Needs attention', amber: 'Check data', green: 'On track' },
  backToSetup: 'Back to setup',
} as const

export function runningLine(days: string, planned: string, people: string) {
  return `Running ${days} days of ${planned} · ${people} people so far`
}
export function decidedLine(date: string, winner: string) { return `Decided ${date}: ${winner}` }
export function noMatchesLine(query: string) { return `No tests match "${query}".` }
