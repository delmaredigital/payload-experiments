'use client'

import type { ReactNode } from 'react'
import type { RenderedExposure } from '../types/assignments.js'
import { ViewportExposure } from './ViewportExposure.js'

export function ExperimentGroup({ expose, children }: { expose?: RenderedExposure; children: ReactNode }) {
  return <ViewportExposure expose={expose}>{children}</ViewportExposure>
}
