import type { Data } from '@puckeditor/core'
import type { Assignments, RenderedExposure } from '../types/assignments.js'
import { XpNotImplemented } from '../errors.js'

export function resolveExperimentData<TData extends Data>(_puckData: TData, _assignments: Assignments): { data: TData; rendered: RenderedExposure[] } {
  throw new XpNotImplemented('CORE-07')
}
