import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'
import { __resetBeaconsForTests } from '../../src/client/beacon.js'

afterEach(__resetBeaconsForTests)
const path = (name: string) => fileURLToPath(new URL(`../../src/${name}`, import.meta.url))

test.each(['ExperimentsProvider.tsx', 'useFlagPoint.ts', 'useExperiment.ts', 'ExperimentPageview.tsx', 'ViewportExposure.tsx'])('%s directly imports the one context export', file => {
  const entry = path(`client/${file}`)
  expect(collectImports(entry).files).toContain(path('client/context.ts'))
  expect(readFileSync(entry, 'utf8')).toMatch(/import \{ ExperimentsContext \} from '\.\/context\.js'/)
})

test('client barrel and internal viewport leaf reach exactly one context instance; viewport never imports provider', () => {
  for (const entry of [path('exports/client.ts'), path('client/ViewportExposure.tsx')]) {
    expect(collectImports(entry).files.filter(file => file.endsWith('/context.ts'))).toEqual([path('client/context.ts')])
  }
  expect(collectImports(path('client/ViewportExposure.tsx')).files).not.toContain(path('client/ExperimentsProvider.tsx'))
  expect(readFileSync(path('client/context.ts'), 'utf8').match(/createContext</g)).toHaveLength(1)
})
