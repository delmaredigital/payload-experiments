'use client'

import { EXPERIMENT_SLOT_TYPE, type ExperimentsPuckIntegration } from '../../types/puck.js'
import { categoryTitle } from '../copy.js'
import type { PuckRoutes } from '../routes.js'
import { createExperimentSlotEditor } from './ExperimentSlotEditor.js'
import type { EditorTestSurface } from './ConfigureTestDrawer.js'
import { experimentOutlinePlugin } from './experimentOutlinePlugin.js'

/**
 * Call once at module scope in a 'use client' module. A new object per render
 * rebuilds Puck's config and plugin list.
 */
export function experimentsPuckEditor({ routes, accent, surface }: { routes?: PuckRoutes; accent?: string; surface?: EditorTestSurface } = {}): ExperimentsPuckIntegration {
  return {
    name: 'experiments',
    components: { [EXPERIMENT_SLOT_TYPE]: createExperimentSlotEditor({ routes, accent, surface }) },
    categories: { experiments: { title: categoryTitle, components: [EXPERIMENT_SLOT_TYPE] } },
    plugins: [experimentOutlinePlugin()],
  }
}
