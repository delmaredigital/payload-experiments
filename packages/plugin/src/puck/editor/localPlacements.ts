import { walkTree, type Config, type Data } from '@puckeditor/core'

// Puck data/config are immutable. Selection, hover and drag state reuse this
// result, and every block on the page shares a single traversal per data change.
const pages = new WeakMap<Data, WeakMap<Config, Map<string, Set<string>>>>()
export function localPlacements(data: Data, config: Config): Map<string, Set<string>> {
  let configs = pages.get(data)
  if (!configs) { configs = new WeakMap(); pages.set(data, configs) }
  let placements = configs.get(config)
  if (!placements) {
    placements = new Map()
    const collect = (content: import('@puckeditor/core').ComponentData[]) => {
      for (const item of content) if (item.type === 'ExperimentSlot' && item.props.experiment?.id !== undefined) {
        const key = String(item.props.experiment.id)
        const ids = placements!.get(key) ?? new Set<string>()
        ids.add(item.props.id)
        placements!.set(key, ids)
      }
    }
    walkTree(data, config, content => { collect(content) })
    for (const content of Object.values(data.zones ?? {})) collect(content)
    configs.set(config, placements)
  }
  return placements
}
