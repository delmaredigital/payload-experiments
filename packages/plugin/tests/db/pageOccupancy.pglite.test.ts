import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { routedPageTests } from '../../src/db/pageOccupancy.js'
import { pageArms, pageOccupancyDb } from '../_helpers/pageOccupancy.js'

describe.each(['serial', 'uuid'] as const)('%s page occupancy', idType => {
  let database: Awaited<ReturnType<typeof pageOccupancyDb>>
  beforeAll(async () => { database = await pageOccupancyDb(idType) }, 60_000)
  afterAll(async () => { await database?.close() })

  test('running tests route the latest round, independent of insertion order or document arms', async () => {
    const arms = pageArms('/latest')
    const id = await database.addTest(1, 'running', '/edited', [
      { phase: 3, kind: 'test', arms },
      { phase: 1, kind: 'test', arms: pageArms('/oldest') },
      { phase: 2, kind: 'test', arms: pageArms('/older') },
    ])
    expect(await routedPageTests(database.exec)).toContainEqual({ id, arms })
  })

  test('decided rollouts route the latest test round, including its Original and holdout', async () => {
    const arms = pageArms('/test')
    arms.push({ key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 0, pageTarget: '/holdout' })
    const rolloutArms = [arms[1]!, arms[2]!]
    const id = await database.addTest(2, 'decided', '/document', [
      { phase: 4, kind: 'rollout', arms: rolloutArms },
      { phase: 1, kind: 'test', arms: pageArms('/previous-test') },
      { phase: 3, kind: 'test', arms },
      { phase: 2, kind: 'rollout', arms: [pageArms('/previous-test')[1]!] },
    ])
    expect(await routedPageTests(database.exec)).toContainEqual({ id, arms })
  })

  test('a stopped document edited to /y still occupies frozen /x when decided', async () => {
    const arms = pageArms('/x')
    const id = await database.addTest(3, 'stopped', '/x', [{ phase: 1, kind: 'test', arms }])
    await database.exec.query('UPDATE xp_experiments_arms SET page_target = $1 WHERE _parent_id = $2', ['/y', id])
    expect((await routedPageTests(database.exec)).some(test => test.id === id)).toBe(false)
    await database.exec.query('UPDATE xp_experiments SET status = $1 WHERE id = $2', ['decided', id])
    expect(await routedPageTests(database.exec)).toContainEqual({ id, arms })
  })

  test('draft, stopped, archived and non-page tests do not occupy paths', async () => {
    for (const [index, status] of ['draft', 'stopped', 'archived'].entries()) {
      await database.addTest(10 + index, status, '/excluded', [{ phase: 1, kind: 'test', arms: pageArms('/excluded') }])
    }
    for (const [index, kind] of ['block', 'flag', 'code'].entries()) {
      await database.addTest(20 + index, 'running', '/excluded', [{ phase: 1, kind: 'test', arms: pageArms('/excluded') }], kind)
    }
    const rows = await routedPageTests(database.exec)
    expect(rows.map(row => row.id)).toEqual([database.id(1), database.id(2), database.id(3)])
  })

  test('an archived test whose result stands occupies its rewrite sources, not the winner path', async () => {
    const arms = pageArms('/archived')
    const id = await database.addTest(30, 'archived', '/archived', [{ phase: 1, kind: 'test', arms }], 'page', { winnerArm: 'variantA' })
    const row = (await routedPageTests(database.exec)).find(test => test.id === id)!
    expect(row.arms.map(arm => arm.pageTarget)).toEqual(['/archived'])
  })

  test.each(['discardedAt', 'pagesReleasedAt'] as const)('an archived test with %s occupies nothing', async field => {
    const value = field === 'discardedAt' ? 31 : 32
    const id = await database.addTest(value, 'archived', '/freed', [{ phase: 1, kind: 'test', arms: pageArms(`/freed-${value}`) }], 'page',
      { winnerArm: 'variantA', [field]: '2026-11-03T00:00:00Z' })
    expect((await routedPageTests(database.exec)).some(test => test.id === id)).toBe(false)
  })
})
