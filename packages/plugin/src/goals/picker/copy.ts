/** Shared by Payload's field and the Puck sidebar, without either UI dependency. */
export const CLICK_GOAL_COPY = {
  label: 'Click goal',
  none: 'No click goal',
  loadError: "Couldn't load goals. Try again.",
  retry: 'Try again',
  newGoal: '+ New click goal',
  title: 'New click goal',
  name: 'Name',
  slug: 'Short name',
  advanced: 'Advanced',
  createGoal: 'Create goal',
  cancel: 'Cancel',
  undefinedKey: 'This click goal is missing. Choose another goal or “No click goal”.',
  invalidKey: 'Use a click goal short name.',
  slugRule: 'Use 1–64 lowercase letters, numbers, underscores or hyphens, starting with a letter or number.',
  duplicateSlug: 'Another goal already uses this short name. Change it under Advanced.',
  saveError: "Couldn't save the goal. Try again.",
} as const

export function puckGoalRefusal(rawKey: string, block: string, malformed: boolean, more = 0): string {
  // A malformed key can be any length; keep the dialog readable.
  const key = rawKey.length > 64 ? `${rawKey.slice(0, 64)}…` : rawKey
  const sentence = malformed
    ? `Click goal "${key}" on the ${block} block isn't a valid short name. Use lowercase letters, numbers, - and _, then publish.`
    : `Click goal "${key}" doesn't exist yet. Create it with "+ New click goal" on the ${block} block, then publish.`
  return sentence + (more > 0 ? ` (and ${more} more)` : '')
}
