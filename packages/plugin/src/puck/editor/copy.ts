export const editorCopy = {
  labels: { control: 'Original', variantA: 'Variant A', variantB: 'Variant B', variantC: 'Variant C' },
  unbound: 'Choose or create a test to show different versions.',
  draft: 'This block shows the Original to everyone until the test starts.',
  running: 'Changing this content mid-test mixes two versions in one result',
  decided: (winner: string) => `Decided: ${winner}. Use 'Make it the content' on the test to finish.`,
  archived: 'This test is archived; the winning content is shown to everyone.',
  copy: 'Copy Original to this version',
  dropZone: (slot: 'control' | 'variantA' | 'variantB' | 'variantC') => slot === 'control'
    ? 'Drop the original content here'
    : `Drop ${editorCopy.labels[slot]} content here`,
  replaceConfirm: (label: string) => `${label} already has content. Replace it with a copy of the Original?`,
  replace: 'Replace',
  createLabel: 'Test this block',
  creating: 'Creating…',
  cancel: 'Cancel',
  name: 'Name',
  setup: 'Set up the test',
  nameExists: "This name is too close to an existing test. Choose a different name.",
  createError: "Couldn't create the test. Try again.",
  loading: 'Loading test…',
  loadError: "Couldn't load this test. Try selecting it again.",
  tabs: 'Test versions',
} as const
