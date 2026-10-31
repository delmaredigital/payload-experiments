import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'

const src = fileURLToPath(new URL('../../src/', import.meta.url))
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name)
    return entry.isDirectory() ? files(file) : [file]
  })
}
function startsWithClient(file: string): boolean {
  const first = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true).statements[0]
  return Boolean(first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use client')
}

test('all admin, client and Puck editor components start with the client directive', () => {
  const clients = [
    ...files(join(src, 'admin')).filter(file => file.endsWith('.tsx')),
    ...files(join(src, 'client')).filter(file => /\.(ts|tsx)$/.test(file) && file !== join(src, 'client/context.ts')),
    ...files(join(src, 'puck/editor')).filter(file => file.endsWith('.tsx')),
    ...['puck/ExperimentPicker.tsx', 'client/ViewportExposure.tsx', 'exports/client.ts', 'exports/adminClient.ts', 'exports/puckEditor.ts'].map(file => join(src, file)),
  ]
  for (const file of new Set(clients)) expect(startsWithClient(file), file).toBe(true)
})

test.each(['ExperimentSlot.tsx', 'experimentSlotField.ts', 'slotConfig.ts', 'slot.model.ts', 'copy.ts', '../exports/puck.ts'])('Puck server module %s has no client directive', file => {
  expect(startsWithClient(join(src, 'puck', file))).toBe(false)
})

test('the first-statement checker skips comments and blank lines, and rejects missing or late directives', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xp-directives-'))
  try {
    const file = join(directory, 'component.tsx')
    writeFileSync(file, "// leading comment\n\n/* another comment */\n'use client'\nexport const X = 1\n")
    expect(startsWithClient(file)).toBe(true)
    writeFileSync(file, '// leading comment\n\nexport const X = 1\n')
    expect(startsWithClient(file)).toBe(false)
    writeFileSync(file, "import './helper.js'\n'use client'\n")
    expect(startsWithClient(file)).toBe(false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
