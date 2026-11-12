import type { ComponentType } from 'react'
import type { TestsSurfaceProps } from '../../types/surface.js'
import type { SerializedAttributeKeys, SerializedFlagPoint, SerializedMetricSource } from '../../types/admin.js'
import type { useTestDocument } from './useTestDocument.js'

/** Sections of the test page, in readiness order (surface spec §6.2, §8). */
export type SectionId = 'what' | 'versions' | 'win' | 'who' | 'length' | 'advanced'
export const SECTION_ORDER: readonly SectionId[] = ['what', 'versions', 'win', 'who', 'length', 'advanced']

/** The data layer's return value; every section takes it as `test`. */
export type TestDocApi = ReturnType<typeof useTestDocument>

/** Serialisable props the server root view passes to the surface (ADM-20). */
export interface SurfaceProps {
  adminRoute: string
  apiRoute: string
  collectionTitles?: Record<string, string>
  userId?: string | number
  userCollection?: string
  canManage: boolean
  canReadResults: boolean
  isAdmin: boolean
  flagPoints: SerializedFlagPoint[]
  attributeKeys: SerializedAttributeKeys
  metricSources: SerializedMetricSource[]
  pageCollections?: TestsSurfaceProps['pageCollections']
  admin?: TestsSurfaceProps['admin']
}

export type EditorTestSurface = Omit<SurfaceProps, 'adminRoute' | 'apiRoute'>

export interface SectionProps { test: TestDocApi; surface: SurfaceProps; resultsVersion?: number }

/** Kind-specific pieces the generic test page composes (Setting kind: ADM-22). */
export interface KindParts {
  /** Section 1 body for this kind. */
  Binding: ComponentType<SectionProps>
  /** The content cell of one version row in Section 2. */
  VersionContent: ComponentType<SectionProps & { armIndex: number; summary?: boolean }>
}

/** Readiness pieces (ADM-23). */
export interface ReadinessParts {
  /** Sticky-header banner incl. Start / status sentence. */
  Banner: ComponentType<SectionProps>
  /** "Saving…" / "Saved" / error indicator for the header. */
  SaveStatus: ComponentType<{ test: TestDocApi }>
  /** Check-circle state per section, from preflight. */
  sectionDone(test: TestDocApi): Record<SectionId, boolean>
}
