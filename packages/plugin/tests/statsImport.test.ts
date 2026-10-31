import { assignArm } from '@delmaredigital/experiments-stats'
import { expect, test } from 'vitest'
test('stats value exports resolve through the source condition', () => { expect(typeof assignArm).toBe('function') })
