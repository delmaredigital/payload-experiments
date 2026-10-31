// Schema-only copy from main d292db4e74d036d15d012ce1b5892dc4ad1f5ba6; only external import paths adjusted.
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
