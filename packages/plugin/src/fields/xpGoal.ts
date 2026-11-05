import type { TextField } from 'payload'
import { clickKeys } from '../goals/cache.js'
import { CLICK_KEY } from '../goals/key.js'
import type { ResolvedOptions } from '../types/contracts.js'

/** The host renders this value as data-xp-goal on its interactive element. */
export function xpGoalField(): TextField {
  return { name: 'xpGoal', label: 'Click goal', type: 'text',
    admin: { description: 'Choose the short name of the click goal to count here.' },
    validate: async (value, { req }) => {
      if (!value) return true
      if (!CLICK_KEY.test(value)) return 'Use a click goal short name.'
      const options = req.payload.config.custom?.xp as ResolvedOptions | undefined
      if (!options || await options.access.manage({ req }) !== true) return true
      const keys = await clickKeys(req.payload)
      return !keys || keys.has(value) || 'No click goal has this name yet. Create it with "+ New click goal".'
    },
  }
}
