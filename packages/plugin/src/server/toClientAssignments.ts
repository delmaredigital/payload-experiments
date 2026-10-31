import type { Assignments, ClientAssignments } from '../types/assignments.js'
import { XpNotImplemented } from '../errors.js'

export function toClientAssignments(_assignments: Assignments, _opts: { pathname: string; apiRoute?: string; flagPoints?: string[]; experiments?: string[] }): ClientAssignments {
  throw new XpNotImplemented('CORE-07')
}
