import type { TextField } from 'payload'
import { XP_GOAL_FIELD } from '../admin/paths.js'
import { validateClickGoal } from '../goals/validate.js'

/** The host renders this value as data-xp-goal on its interactive element. */
export function xpGoalField(): TextField {
  return { name: 'xpGoal', label: 'Click goal', type: 'text',
    admin: { description: 'Choose the click goal to count here.', components: { Field: XP_GOAL_FIELD } },
    validate: (value, { req }) => validateClickGoal(value, req),
  }
}
