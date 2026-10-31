'use client'
// XP-PLACEHOLDER
import type { DocId } from '../types/contracts.js'
import { XpNotImplemented } from '../errors.js'
export function useFlagPoint<P extends Record<string, unknown> = Record<string, unknown>>(_id: string): { arm: string; params: P; source: 'experiment' | 'default'; experiment?: string; experimentId?: DocId; expose(renderedArm: string): void } { throw new XpNotImplemented('ADM') }
