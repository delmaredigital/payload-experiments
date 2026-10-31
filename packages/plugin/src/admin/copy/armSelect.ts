export const ARM_SELECT_COPY = {
  experiment: 'Experiment', group: 'Group', clear: 'Clear',
  forbidden: "You can't see experiments. Ask an admin.",
  unavailable: "Experiments couldn't be loaded. Reload and try again.",
  loading: 'Loading experiments…',
  running: 'Changing this content mid-test mixes two versions in one result',
  noFlagPoint: 'No flag point is configured for this field.',
}
export const staleExperiment = (name?: string) => `This was set for an earlier experiment${name ? ` (${name})` : ''} and won't be used now.`
