import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, vi } from 'vitest'
import { hasClientDirective } from '../puck/clientDirective.js'

// These scans parse every src file with the TypeScript compiler; give them room under a loaded full-suite run.
vi.setConfig({ testTimeout: 30_000 })

const src = fileURLToPath(new URL('../../src/', import.meta.url))
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name)
    return entry.isDirectory() ? files(file) : [file]
  })
}
function isClient(file: string): boolean {
  return hasClientDirective(readFileSync(file, 'utf8'))
}

test('all admin, client and Puck editor components have a leading client directive', () => {
  const clients = [
    ...files(join(src, 'admin')).filter(file => file.endsWith('.tsx') && !file.includes('/admin/views/')),
    ...files(join(src, 'client')).filter(file => /\.(ts|tsx)$/.test(file) && file !== join(src, 'client/context.ts')),
    ...files(join(src, 'puck/editor')).filter(file => file.endsWith('.tsx')),
    ...['puck/ExperimentPicker.tsx', 'client/ViewportExposure.tsx', 'exports/client.ts', 'exports/adminClient.ts', 'exports/puckEditor.ts'].map(file => join(src, file)),
  ]
  for (const file of new Set(clients)) expect(isClient(file), file).toBe(true)
})

test.each(['ExperimentSlot.tsx', 'experimentSlotField.ts', 'slotConfig.ts', 'slot.model.ts', 'copy.ts', '../exports/puck.ts'])('Puck server module %s has no client directive', file => {
  expect(isClient(join(src, 'puck', file))).toBe(false)
})

test('the prologue checker skips comments and blank lines, and rejects missing or late directives', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xp-directives-'))
  try {
    const file = join(directory, 'component.tsx')
    writeFileSync(file, "// leading comment\n\n/* another comment */\n'use client'\nexport const X = 1\n")
    expect(isClient(file)).toBe(true)
    writeFileSync(file, "'use strict'; 'use client';\nexport const X = 1\n")
    expect(isClient(file)).toBe(true)
    writeFileSync(file, '// leading comment\n\nexport const X = 1\n')
    expect(isClient(file)).toBe(false)
    writeFileSync(file, "import './helper.js'\n'use client'\n")
    expect(isClient(file)).toBe(false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})


test('Tests server view placeholders have no client directive', () => {
  expect(isClient(join(src, 'admin/views/placeholders.tsx'))).toBe(false)
})
