import type { CollectionConfig, GlobalConfig } from 'payload'
import type { ResolvedOptions } from '../types/contracts.js'
import { experimentsCollection } from './experiments/config.js'
import { phasesCollection } from './phases.js'
import { layersCollection } from './layers.js'
import { metricsCollection } from './metrics.js'
import { eventsCollection } from './events.js'
import { identitiesCollection } from './identities.js'
import { snapshotsCollection } from './snapshots.js'
import { stateGlobal } from '../globals/state.js'

export function buildCollections(options: ResolvedOptions): { collections: CollectionConfig[]; globals: GlobalConfig[] } {
  return {
    collections: [experimentsCollection(options), phasesCollection(options), layersCollection(options), metricsCollection(options), eventsCollection(options), identitiesCollection(options), snapshotsCollection(options)],
    globals: [stateGlobal(options)],
  }
}
