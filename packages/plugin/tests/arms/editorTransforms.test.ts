import { afterEach, expect, test, vi } from 'vitest'
import { defaultArms, splitEvenly } from '../../src/arms/model.js'
import { addLeftoverArms, addVersionArms, ArmWriteError, removeVersionArms, renameVersionArms, setVersionTraffic, writeArms } from '../../src/puck/editor/armWrites.js'
import { editorCopy as C } from '../../src/puck/editor/copy.js'
import type { Arm } from '../../src/types/contracts.js'

const pair = () => defaultArms('block').map((arm, i) => ({ ...arm, weight: i ? 30 : 70 }))
const full = (): Arm[] => [...pair(),
  { key: 'variantB', slot: 'variantB', kind: 'variant', label: 'Variant B', weight: 0 },
  { key: 'variantC', slot: 'variantC', kind: 'variant', label: 'Variant C', weight: 0 },
]
afterEach(() => vi.unstubAllGlobals())

test.each<{ name: string; arms: () => Arm[]; transform: (arms: Arm[]) => Arm[] }>([
  { name: 'Remove missing variant', arms: pair, transform: arms => removeVersionArms(arms, 'variantB') },
  { name: 'Remove missing holdout', arms: pair, transform: arms => removeVersionArms(arms, 'holdout') },
  { name: 'Remove Original', arms: pair, transform: arms => removeVersionArms(arms, 'control') },
  { name: 'Traffic missing version', arms: pair, transform: arms => setVersionTraffic(arms, 'variantB', 60) },
  { name: 'Traffic without another version to balance', arms: () => [{ ...pair()[0]!, weight: 100 }], transform: arms => setVersionTraffic(arms, 'control', 60) },
  { name: 'Add at the version cap', arms: full, transform: addVersionArms },
  { name: 'Add without Original', arms: () => [pair()[1]!], transform: addVersionArms },
  { name: 'leftover Add already in the test', arms: pair, transform: arms => addLeftoverArms(arms, 'variantA') },
  { name: 'leftover Add without Original', arms: () => [pair()[1]!], transform: arms => addLeftoverArms(arms, 'variantB') },
  { name: 'leftover Add at the version cap', arms: full, transform: arms => addLeftoverArms(arms, 'variantB') },
  { name: 'Name missing version', arms: pair, transform: arms => renameVersionArms(arms, 'variantB', 'New name') },
])('$name refuses stale intent without changing weights or sending a PATCH', async ({ arms: makeArms, transform }) => {
  const arms = makeArms(), before = structuredClone(arms)
  expect(() => transform(arms)).toThrowError(new ArmWriteError(C.staleEdit))
  const doc = { name: 'Example', status: 'draft', updatedAt: 'fresh', arms }
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(doc)))
  const publish = vi.fn()
  await expect(writeArms('/api/xp-experiments/test', transform, publish)).rejects.toThrow(C.staleEdit)
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/xp-experiments/test?depth=0', { credentials: 'include', cache: 'no-store' })
  expect(publish).toHaveBeenCalledExactlyOnceWith(doc)
  expect(arms).toEqual(before)
})

test('valid version intents preserve current metadata and work from fresh arms', () => {
  const arms = pair(), before = structuredClone(arms)
  expect(removeVersionArms(arms, 'variantA')).toEqual([{ ...arms[0], weight: 100 }])
  expect(setVersionTraffic(arms, 'variantA', 40).map(arm => arm.weight)).toEqual([60, 40])
  expect(renameVersionArms(arms, 'variantA', 'Fresh label')).toEqual([arms[0], { ...arms[1], label: 'Fresh label' }])
  expect(addVersionArms(arms)).toEqual([...arms, { key: 'variantB', slot: 'variantB', kind: 'variant', label: 'Variant B', weight: 0 }])
  const holdout: Arm = { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 }
  expect(addLeftoverArms([...arms, holdout], 'variantC')).toEqual([...arms,
    { key: 'variantC', slot: 'variantC', kind: 'variant', label: 'Variant C', weight: 0 }, holdout])
  // Split has no individual target: it splits only the versions still present.
  expect(splitEvenly([arms[0]!, holdout])).toEqual([{ ...arms[0], weight: 90 }, holdout])
  expect(arms).toEqual(before)
})
