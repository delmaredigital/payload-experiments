'use client'
// XP-PLACEHOLDER
import { XpNotImplemented } from '../errors.js'
export function useExperiment<P extends Record<string, unknown> = Record<string, unknown>>(_slug: string): { arm: string; params: P; expose(renderedArm: string): void } { throw new XpNotImplemented('ADM') }
