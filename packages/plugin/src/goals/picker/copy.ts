/** Shared by Payload's field and the Puck sidebar, without either UI dependency. */
export const CLICK_GOAL_COPY = {
  label: 'Click goal',
  choose: 'Choose a click goal',
  newGoal: '+ New click goal',
  title: 'New click goal',
  name: 'Name',
  slug: 'Short name',
  advanced: 'Advanced',
  createGoal: 'Create goal',
  cancel: 'Cancel',
  undefinedKey: 'No click goal has this name yet. Create it with "+ New click goal".',
  slugRule: 'Use 1–64 lowercase letters, numbers, underscores or hyphens, starting with a letter or number.',
  duplicateSlug: 'Another goal already uses this short name. Change it under Advanced.',
  saveError: "Couldn't save the goal. Try again.",
} as const
