import type { SerializedAttributeKeys, SerializedFlagPoint, SerializedMetricSource } from './admin.js'

export type TestsRoute = 'home' | 'new' | 'test' | 'results'
export interface TestsSurfaceProps {
  route: TestsRoute
  id?: string
  adminRoute: string
  apiRoute: string
  canManage: boolean
  canReadResults: boolean
  flagPoints: SerializedFlagPoint[]
  attributeKeys: SerializedAttributeKeys
  metricSources: SerializedMetricSource[]
  admin?: { descriptions?: { block?: string; document?: string; setting?: string } }
}
