// Schema-only copy of CORE-02a ba8d1c703430d8908f13a3669a31f8e3bfb8a9b5; only external import paths adjusted.
import type { CollectionConfig, GlobalConfig } from 'payload'
import type { ResolvedOptions } from '../../../../src/types/contracts.js'
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
