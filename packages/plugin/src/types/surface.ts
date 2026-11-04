import type { DocId } from './contracts.js'
import type { SerializedAttributeKeys, SerializedFlagPoint, SerializedMetricSource } from './admin.js'

export type TestsRoute = 'home' | 'new' | 'test' | 'results' | 'goals' | 'goalNew' | 'goal'
export interface TestsSurfaceProps {
  route: TestsRoute
  id?: string
  returnToTest?: string
  adminRoute: string
  apiRoute: string
  isAdmin: boolean
  pages?: Array<{ collection: string; collectionLabel: string; id: DocId; title: string; editorUrl: string }>
  pageCollections?: Array<{ slug: string; label: string; copyHint?: string; copyUrl?: string; copyLabel?: string }>
  canManage: boolean
  canReadResults: boolean
  flagPoints: SerializedFlagPoint[]
  attributeKeys: SerializedAttributeKeys
  metricSources: SerializedMetricSource[]
  admin?: { descriptions?: { page?: string; block?: string; document?: string; setting?: string } }
}
