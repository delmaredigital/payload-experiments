import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
function isHomeURLFormatter(file: string, node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  const bindings = clause?.namedBindings
  return file === fileURLToPath(new URL('../../src/admin/surface/home.model.ts', import.meta.url))
    && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'payload/shared'
    && !clause?.name && Boolean(bindings && ts.isNamedImports(bindings) && bindings.elements.length === 1
      && (bindings.elements[0]!.propertyName ?? bindings.elements[0]!.name).text === 'formatAdminURL')
}
function isSurfaceTypeImport(file: string, node: ts.ImportDeclaration): boolean {
  const clause = node.importClause
  const bindings = clause?.namedBindings
  // The shared order is a runtime dependency, but these two imports are erased.
  // In particular ReturnType<typeof useTestDocument> never runs the React hook.
  return file === fileURLToPath(new URL('../../src/admin/surface/contracts.ts', import.meta.url))
    && ts.isStringLiteral(node.moduleSpecifier)
    && Boolean(clause?.isTypeOnly) && !clause?.name && Boolean(bindings && ts.isNamedImports(bindings)
      && bindings.elements.length === 1 && (
      node.moduleSpecifier.text === 'react' && (bindings.elements[0]!.propertyName ?? bindings.elements[0]!.name).text === 'ComponentType'
      || node.moduleSpecifier.text === './useTestDocument.js' && (bindings.elements[0]!.propertyName ?? bindings.elements[0]!.name).text === 'useTestDocument'))
}
function checkModels(entries: readonly string[]): string[] {
  const violations: string[] = []
  const visited = new Set<string>()
  const options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext }
  const isTypesFile = (file: string) => /\/src\/types\//.test(file)
  function visit(entry: string) {
    // Follow value and relative type-only edges: an erased helper must be pure too.
    for (const file of collectImports(entry).files) {
      if (visited.has(file)) continue
      visited.add(file)
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      function check(specifier: string, isTypeOnly = false, allowedFormatter = false) {
        // ADM-20 fix brief requires Payload's URL formatter for home card links.
        if (allowedFormatter) return
        // src/types/runtime.ts is frozen and type-imports NextRequest; type-only edges there are erased at build.
        if (isTypeOnly && isTypesFile(file) && !specifier.startsWith('.')) return
        if (/^(?:react(?:-dom)?(?:\/|$)|payload(?:\/|$)|@payloadcms\/|next(?:\/|$))/.test(specifier)) violations.push(`${file}: ${specifier}`)
        // collectImports skips type-only edges and require(); inspect both here.
        if (specifier.startsWith('.')) {
          const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
          if (!resolved) throw new Error(`Unresolved import ${specifier} from ${file}`)
          if (isTypeOnly && isTypesFile(resolved.resolvedFileName)) return
          visit(resolved.resolvedFileName)
        }
      }
      function walk(node: ts.Node) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const clause = node.importClause
          const bindings = clause?.namedBindings
          const onlyTypeNames = bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly)
          check(node.moduleSpecifier.text, clause?.isTypeOnly || Boolean(onlyTypeNames && !clause?.name),
            isHomeURLFormatter(file, node) || isSurfaceTypeImport(file, node))
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const names = node.exportClause
          const onlyTypeNames = names && ts.isNamedExports(names) && names.elements.length > 0 && names.elements.every(item => item.isTypeOnly)
          check(node.moduleSpecifier.text, node.isTypeOnly || Boolean(onlyTypeNames))
        }
        else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
          const expression = node.moduleReference.expression
          if (expression && ts.isStringLiteralLike(expression)) check(expression.text, node.isTypeOnly)
        } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
          const arg = node.arguments[0]
          if (arg && ts.isStringLiteralLike(arg)) check(arg.text)
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
          check(node.argument.literal.text, true)
        }
        ts.forEachChild(node, walk)
      }
      walk(source)
    }
  }
  entries.forEach(visit)
  return violations
}

test('the shared click-goal picker model stays independent of either host UI', () => {
  expect(checkModels([fileURLToPath(new URL('../../src/goals/picker/clickGoalPicker.model.ts', import.meta.url))])).toEqual([])
})
test('all models are pure, following type-only helpers up to the src/types boundary', () => {
  expect(checkModels(models(new URL('../../src/', import.meta.url)))).toEqual([])
})

test('src/types permits erased external edges reached by a model value import, but rejects value edges', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xp-model-types-'))
  try {
    const types = join(directory, 'src/types')
    mkdirSync(types, { recursive: true })
    const file = join(directory, 'example.model.ts')
    const contract = join(types, 'runtime.ts')
    writeFileSync(file, "import { X } from './src/types/runtime.js'")
    for (const specifier of ['next/server', 'payload', 'react', '@payloadcms/ui']) {
      for (const edge of [
        `import type { NextRequest } from '${specifier}'`,
        `import { type NextRequest } from '${specifier}'`,
        `export type { NextRequest } from '${specifier}'`,
        `export { type NextRequest } from '${specifier}'`,
        `type Request = import('${specifier}').NextRequest`,
      ]) {
        writeFileSync(contract, `${edge}\nexport const X = 1`)
        expect(checkModels([file]), edge).toEqual([])
      }
      for (const edge of [
        `import { NextRequest } from '${specifier}'`,
        `import { type NextRequest, X } from '${specifier}'`,
        `export { NextRequest } from '${specifier}'`,
      ]) {
        writeFileSync(contract, edge)
        expect(checkModels([file]), edge).toEqual([`${contract}: ${specifier}`])
      }
    }
    writeFileSync(contract, "import React from 'react'")
    for (const edge of [
      "import type { X } from './src/types/runtime.js'",
      "import { type X } from './src/types/runtime.js'",
      "export type { X } from './src/types/runtime.js'",
      "type X = import('./src/types/runtime.js').X",
    ]) {
      writeFileSync(file, edge)
      expect(checkModels([file]), edge).toEqual([])
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
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

test('surface access and home models are included in the purity scan', () => {
  const entries = models(new URL('../../src/admin/', import.meta.url))
  for (const name of ['access', 'home']) expect(entries.some(file => file.endsWith(`/${name}.model.ts`))).toBe(true)
})

test('only home card URL formatting may import Payload shared code', () => {
  const home = fileURLToPath(new URL('../../src/admin/surface/home.model.ts', import.meta.url))
  for (const [file, source, allowed] of [
    [home, "import { formatAdminURL } from 'payload/shared'", true],
    [home.replace('home.model.ts', 'other.model.ts'), "import { formatAdminURL } from 'payload/shared'", false],
    [home, "import { other } from 'payload/shared'", false],
    [home, "import { formatAdminURL, other } from 'payload/shared'", false],
    [home, "import * as shared from 'payload/shared'", false],
    [home, "import { formatAdminURL } from 'payload'", false],
  ] as const) {
    const node = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true).statements[0]!
    expect(ts.isImportDeclaration(node) && isHomeURLFormatter(file, node), source).toBe(allowed)
  }
})
test('only the erased surface contract imports are allowed, never React or hook value edges', () => {
  const contract = fileURLToPath(new URL('../../src/admin/surface/contracts.ts', import.meta.url))
  for (const [file, source, allowed] of [
    [contract, "import type { ComponentType } from 'react'", true],
    [contract, "import { ComponentType } from 'react'", false],
    [contract, "import type { ComponentType, ReactNode } from 'react'", false],
    [contract.replace('contracts.ts', 'other.ts'), "import type { ComponentType } from 'react'", false],
    [contract, "import type { useTestDocument } from './useTestDocument.js'", true],
    [contract, "import { useTestDocument } from './useTestDocument.js'", false],
    [contract.replace('contracts.ts', 'other.ts'), "import type { useTestDocument } from './useTestDocument.js'", false],
  ] as const) {
    const node = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true).statements[0]!
    expect(ts.isImportDeclaration(node) && isSurfaceTypeImport(file, node), source).toBe(allowed)
  }
  expect(collectImports(contract).bare).not.toContain('react')
  expect(collectImports(contract).files.some(file => file.endsWith('/useTestDocument.ts'))).toBe(false)
})
