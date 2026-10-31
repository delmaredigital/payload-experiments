import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'
import { collectImports } from '../_helpers/importGraph.js'

function models(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    return entry.isDirectory() ? models(url) : entry.name.endsWith('.model.ts') ? [fileURLToPath(url)] : []
  })
}
function checkModels(entries: readonly string[]): string[] {
  const violations: string[] = []
  const visited = new Set<string>()
  const options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext }
  function visit(entry: string) {
    // Follow value and relative type-only edges: an erased helper must be pure too.
    for (const file of collectImports(entry).files) {
      if (visited.has(file)) continue
      visited.add(file)
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      function check(specifier: string) {
        if (/^(?:react(?:-dom)?(?:\/|$)|@payloadcms\/|next(?:\/|$))/.test(specifier)) violations.push(`${file}: ${specifier}`)
        // collectImports skips type-only edges and require(); inspect both here.
        if (specifier.startsWith('.')) {
          const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
          if (!resolved) throw new Error(`Unresolved import ${specifier} from ${file}`)
          visit(resolved.resolvedFileName)
        }
      }
      function walk(node: ts.Node) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text)
        else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text)
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
          const expression = node.moduleReference.expression
          if (expression && ts.isStringLiteralLike(expression)) check(expression.text)
        } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
          const arg = node.arguments[0]
          if (arg && ts.isStringLiteralLike(arg)) check(arg.text)
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
          check(node.argument.literal.text)
        }
        ts.forEachChild(node, walk)
      }
      walk(source)
    }
  }
  entries.forEach(visit)
  return violations
}
test('all models are free of React, Payload UI and Next imports, including types and transitive helpers', () => {
  expect(checkModels(models(new URL('../../src/', import.meta.url)))).toEqual([])
})
test('the checker reports planted imports and transitive helpers but ignores ordinary strings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xp-model-purity-'))
  const fixtures = [
    "import type { X } from 'react'",
    "export * from 'react-dom/client'",
    "import type { X } from '@payloadcms/ui'",
    "export type { X } from '@payloadcms/db-postgres'",
    "import('next/navigation')",
    "require('next')",
    "import ui = require('@payloadcms/ui')",
    "import './helper.js'",
    "require('./helper.js')",
    "import type { X } from './helper.js'",
    "import { type X } from './helper.js'",
    "export type { X } from './helper.js'",
    "type X = import('./helper.js').X",
  ]
  try {
    writeFileSync(join(directory, 'helper.ts'), "export type { X } from './nested.js'")
    writeFileSync(join(directory, 'nested.ts'), "import React from 'react'")
    for (const [index, fixture] of fixtures.entries()) {
      const file = join(directory, `${index}.model.ts`)
      writeFileSync(file, fixture)
      expect(checkModels([file]), fixture).toHaveLength(1)
    }
    const file = join(directory, 'strings.model.ts')
    writeFileSync(file, "const step = 'next'; const label = 'react'; const packageName = '@payloadcms/ui'")
    expect(checkModels([file])).toEqual([])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
