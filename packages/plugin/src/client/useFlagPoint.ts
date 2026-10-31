'use client'
// XP-PLACEHOLDER
import { XpNotImplemented } from '../errors.js'
export function useFlagPoint<P extends Record<string, unknown> = Record<string, unknown>>(_id: string): { arm: string; params: P; source: 'experiment' | 'default'; experiment?: string; experimentId?: string; expose(renderedArm: string): void } { throw new XpNotImplemented('ADM') }
