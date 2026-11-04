import { EXPERIMENT_SLOT_TYPE, type ExperimentsPuckIntegration } from '../types/puck.js'
import { createExperimentSlot } from './ExperimentSlot.js'
import { categoryTitle } from './copy.js'
import type { PuckRoutes } from './routes.js'

/** Bundle the test block and its sidebar category for a host render config. */
export function experimentsPuck({ routes }: { routes?: PuckRoutes } = {}): ExperimentsPuckIntegration {
  return {
    name: 'experiments',
    components: { [EXPERIMENT_SLOT_TYPE]: createExperimentSlot({ routes }) },
    categories: { experiments: { title: categoryTitle, components: [EXPERIMENT_SLOT_TYPE] } },
  }
}
