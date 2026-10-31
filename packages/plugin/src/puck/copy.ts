export const pickerCopy = {
  label: 'Experiment',
  none: 'No experiment',
  loading: 'Loading experiments…',
  error: "Couldn't load experiments.",
  forbidden: "You can't see experiments. Ask an admin.",
  statuses: {
    draft: 'Draft',
    running: 'Running',
    stopped: 'Stopped',
    decided: 'Decided',
    archived: 'Archived',
  },
} as const
