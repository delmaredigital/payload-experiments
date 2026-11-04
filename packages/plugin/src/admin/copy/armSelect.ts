export const ARM_SELECT_COPY = {
  experiment: 'Test', group: 'Group', clear: 'Clear',
  forbidden: "You can't see tests. Ask an admin.",
  unavailable: "Tests couldn't be loaded. Reload and try again.",
  loading: 'Loading tests…',
  running: 'Changing this content mid-test mixes two versions in one result',
  noFlagPoint: 'No setting is configured for this field.',
}
export const staleExperiment = (name?: string) => `This was set for an earlier test${name ? ` (${name})` : ''} and won't be used now.`
