import type { ExperimentsServerRuntime } from '../types/runtime.js'
import type { FlagPointResult } from '../types/assignments.js'
import { getAssignments } from './getAssignments.js'
import { recordExposures } from './recordExposures.js'
import { suppressExposure } from './context.js'

export async function getFlagPoint<TUser extends { id: string | number } = { id: string | number }>(serverRuntime: ExperimentsServerRuntime<TUser>, id: string, opts?: { user?: TUser | null }): Promise<FlagPointResult & { expose(renderedArm: string): Promise<void> }> {
  const assignments = await getAssignments(serverRuntime, opts)
  const point: FlagPointResult = Object.hasOwn(assignments.flagPoints, id) ? assignments.flagPoints[id]! : { arm: 'control', params: {}, source: 'default', exposable: false }
  const result = { ...point, params: { ...point.params }, exposable: point.exposable && !suppressExposure(assignments) }
  return {
    ...result,
    async expose(renderedArm) {
      if (result.policy !== 'manual' || !result.exposable || !result.experiment || result.phase === undefined) return
      try {
        await recordExposures(serverRuntime, [{ slug: result.experiment, arm: renderedArm, phase: result.phase }], assignments)
      } catch {
        console.error('[payload-experiments] flag point exposure failed')
      }
    },
  }
}
