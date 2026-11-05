import type { TextField } from '@puckeditor/core'

/** Prop config only. Components render xpGoal as data-xp-goal. */
export function xpGoalPuckField(): TextField {
  return { type: 'text', label: 'Click goal' }
}
