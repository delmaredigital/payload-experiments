import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'

function scan(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    return entry.isDirectory() ? scan(url) : /(?:\.[cm]?[jt]sx?|\.css)$/.test(entry.name) ? [fileURLToPath(url)] : []
  })
}
function checkSource(file: string, text: string): string[] {
  const violations: string[] = []
  function check(specifier: string, typeOnly = false) {
    if (specifier.startsWith('@payloadcms/ui') && !['@payloadcms/ui', '@payloadcms/ui/shared'].includes(specifier)
      || specifier.startsWith('@payloadcms/next') || specifier.startsWith('payload/dist') || /\.scss(?:$|[?#])/.test(specifier)
      || specifier === 'payload' && !typeOnly) violations.push(`${file}: ${specifier}`)
  }
  if (file.endsWith('.css')) {
    // Ignore commented-out imports; handle quoted and url() CSS import forms.
    const css = text.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^\s"'();)]+)/gi)) {
      const specifier = match[1]!
      if (specifier.startsWith('@payloadcms/') || /\.scss(?:$|[?#])/.test(specifier)) violations.push(`${file}: ${specifier}`)
    }
    return violations
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  function walk(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text, node.importClause?.isTypeOnly)
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text, node.isTypeOnly)
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression
      if (expression && ts.isStringLiteral(expression)) check(expression.text, node.isTypeOnly)
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      const arg = node.arguments[0]
      if (arg && ts.isStringLiteralLike(arg)) check(arg.text)
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  return violations
}
test('UI trees and exports import public UI and Payload types only', () => {
  const violations: string[] = []
  for (const area of ['admin', 'client', 'puck', 'fields', 'exports']) for (const file of scan(new URL(`../../src/${area}/`, import.meta.url))) {
    violations.push(...checkSource(file, readFileSync(file, 'utf8')))
  }
  expect(violations, "Use public UI exports; Payload types must use 'import type', not 'import { type X }'.").toEqual([])
})
test('the checker covers exports, inline type imports and CSS imports', () => {
  expect(checkSource('src/exports/client.ts', "export * from '@payloadcms/ui/dist/private'" )).toHaveLength(1)
  expect(checkSource('field.ts', "import { type Field } from 'payload'")).toHaveLength(1)
  expect(checkSource('field.ts', "import type { Field } from 'payload'")).toEqual([])
  for (const fixture of [
    '@import "@payloadcms/ui";', "@import url('@payloadcms/ui/dist/styles.css');",
    '@import url(@payloadcms/next/styles.css);', '@import "./private.scss";', '@import "./private.scss?theme=dark";',
  ]) expect(checkSource('styles.css', fixture), fixture).toHaveLength(1)
  expect(checkSource('styles.css', '/* @import "private.scss"; */ @import "./public.css";')).toEqual([])
})
