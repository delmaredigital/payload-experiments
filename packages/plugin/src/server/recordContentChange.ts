import { isDeepStrictEqual } from 'node:util'
import type { CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'
import { appendContentChange, contentChangeSavepoint, previousPublishedContent, runningContentExperiment } from '../db/appends.js'
import { txExecutor } from '../db/executor.js'
import { puckCollections } from '../options.js'
import { withTransition } from '../transitions/kernel.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'

type Binding = { field: 'slug' | 'id'; value: DocId; contents: unknown[] }
const slots = ['control', 'variantA', 'variantB', 'variantC'] as const
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

function bindings(data: unknown, puck: boolean): Map<string, Binding> {
  const found = new Map<string, Binding>()
  function add(field: Binding['field'], value: DocId, content: unknown) {
    const key = field + ':' + value
    const binding = found.get(key) ?? { field, value, contents: [] }
    binding.contents.push(content)
    found.set(key, binding)
  }
  function walk(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!object(value)) return
    if (puck && value.type === 'ExperimentSlot' && object(value.props)) {
      const props = value.props
      const slug = typeof props.experiment === 'string' ? props.experiment : object(props.experiment) ? props.experiment.slug : undefined
      if (typeof slug === 'string' && slug) add('slug', slug, {
        id: props.id, ...Object.fromEntries(slots.map(slot => [slot, props[slot] ?? []])),
      })
    } else if (!puck) {
      // Arm-select stores { experiment, arm }. The containing host row owns the
      // content (e.g. vars[].experimentArm + vars[].blocks), not the tag alone.
      for (const tag of Object.values(value)) {
        if (object(tag) && typeof tag.experiment === 'string' && tag.experiment && typeof tag.arm === 'string') {
          add('id', tag.experiment, value)
        }
      }
    }
    Object.values(value).forEach(walk)
  }
  walk(data)
  return found
}

type Baseline = { collection: string; id: DocId; doc?: Record<string, unknown> }
const baselineKey = (collection: string, id: DocId) => `${collection}:${id}`

/** Paired beforeChange capture: previousDoc may be an autosaved draft. */
export async function capturePublishedContent({ req, collection, originalDoc, operation }: Parameters<CollectionBeforeChangeHook>[0]): Promise<void> {
  if (!collection.versions || !collection.versions.drafts) return
  const id = operation === 'create' ? '__create__' : originalDoc.id as DocId
  const baselines = (req.context.xpPublishedContent ??= {}) as Record<string, Baseline>
  const key = baselineKey(collection.slug, id)
  delete baselines[key]
  const audit = await contentChangeSavepoint(txExecutor(req), async () => operation === 'create' ? undefined : previousPublishedContent(req, collection.slug, id))
  if (!audit.ok) throw audit.error
  baselines[key] = { collection: collection.slug, id, doc: audit.result }
}

/** Explicit host helper: failures propagate to the caller. Installed host hooks
 * wrap it with neverThrow. Drafts/autosaves do not affect published content.
 */
export async function recordContentChange({ doc, previousDoc, req, collection }: Pick<Parameters<CollectionAfterChangeHook>[0], 'doc' | 'previousDoc' | 'req' | 'collection'>): Promise<void> {
  const drafts = Boolean(collection.versions && collection.versions.drafts)
  if (drafts && doc._status !== 'published') return
  const options = req.payload.config.custom?.xp as ResolvedOptions | undefined
  const registration = puckCollections(options ?? {}).find(entry => entry.slug === collection.slug)
  const after = bindings(registration ? doc[registration.field] : doc, Boolean(registration))
  const changes = (previous: unknown) => {
    const before = bindings(registration && object(previous) ? previous[registration.field] : previous, Boolean(registration))
    return [...new Set([...before.keys(), ...after.keys()])]
      .filter(key => !isDeepStrictEqual(before.get(key)?.contents, after.get(key)?.contents))
      .map(key => after.get(key) ?? before.get(key)!)
  }
  if (!drafts && !changes(previousDoc).length) return
  // Include discovery reads in the savepoint: a SQL read error also aborts Postgres.
  // An explicit host call must supply its afterChange request's transaction.
  const executor = txExecutor(req)
  const audit = await contentChangeSavepoint(executor, async () => {
    const baselines = req.context.xpPublishedContent as Record<string, Baseline> | undefined
    const key = baselineKey(collection.slug, doc.id)
    const createKey = baselineKey(collection.slug, '__create__')
    const baseline = baselines?.[key] ?? baselines?.[createKey]
    if (baselines) { delete baselines[key]; delete baselines[createKey] }
    // Missing capture must never turn an unchanged publish into a false marker.
    if (drafts && !baseline) throw new Error('Published content baseline was not captured before the write')
    const changed = changes(drafts ? baseline?.doc : previousDoc)
    const experiments = new Map<string, DocId>()
    for (const binding of changed) {
      const experiment = await runningContentExperiment(executor, binding)
      if (experiment) experiments.set(String(experiment.id), experiment.id)
    }
    // Successful audit locks persist until commit; acquire multiple E locks in order.
    for (const [, experimentId] of [...experiments].sort(([a], [b]) => a.localeCompare(b))) {
      await withTransition(req, { experimentId, bump: false, audit: true }, async ({ exec }) => {
        const experiment = await runningContentExperiment(exec, { field: 'id', value: experimentId })
        if (!experiment) return
        await appendContentChange(exec, { experimentId, phase: experiment.phase,
          entry: { at: new Date().toISOString(), doc: { collection: collection.slug, id: doc.id }, by: req.user?.id ?? null },
        })
      })
    }
  })
  if (!audit.ok) throw audit.error
}
