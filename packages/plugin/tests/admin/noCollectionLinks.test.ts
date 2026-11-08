import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'

const surfaceUrls = fileURLToPath(new URL('../../src/admin/surfaceUrls.ts', import.meta.url))
const listPaths = ['/collections/xp-experiments', '/collections/xp-metrics']
function checkSource(path: string, text: string): string[] {
  const occurrences = [...text.matchAll(/collections\/xp-/g)]
  if (path !== surfaceUrls) return occurrences.map(() => path)
  // ADM-L5c ruling: these two in-place lists are canonical. Raw create/edit URLs
  // remain forbidden, as do collection URLs in every other admin source file.
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const allowed: ts.Node[] = []
  function standalone(node: ts.Node): boolean {
    let value = node
    while (ts.isParenthesizedExpression(value.parent) || ts.isAsExpression(value.parent)
      || ts.isSatisfiesExpression(value.parent) || ts.isNonNullExpression(value.parent)) value = value.parent
    const parent = value.parent
    return ts.isVariableDeclaration(parent) && parent.initializer === value
      || ts.isPropertyAssignment(parent) && parent.initializer === value
      || ts.isReturnStatement(parent) && parent.expression === value
      || ts.isArrowFunction(parent) && parent.body === value
  }
  function walk(node: ts.Node) {
    if (ts.isStringLiteralLike(node) && listPaths.includes(node.text) && standalone(node)) allowed.push(node)
    if (ts.isTemplateExpression(node) && listPaths.includes(node.head.text) && node.templateSpans.length === 1 && standalone(node)) {
      const span = node.templateSpans[0]!
      if (span.literal.text === '' && ts.isCallExpression(span.expression)
        && span.expression.expression.getText(source) === 'surfaceQuery'
        && span.expression.arguments.length === 1 && span.expression.arguments[0]!.getText(source) === 'query') allowed.push(node)
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  return occurrences.filter(match => !allowed.some(node => node.getStart(source) <= match.index && match.index < node.end)).map(() => path)
}
function violations(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? violations(path) : checkSource(path, readFileSync(path, 'utf8'))
  })
}
test('admin source links only to the two canonical lists in surfaceUrls', () => {
  expect(violations(fileURLToPath(new URL('../../src/admin/', import.meta.url)))).toEqual([])
})
test('the canonical list exception never permits raw create/edit or other collection URLs', () => {
  for (const path of listPaths) {
    expect(checkSource(surfaceUrls, `const url = '${path}'`)).toEqual([])
    expect(checkSource('another.ts', `const url = '${path}'`)).toHaveLength(1)
    for (const suffix of ['/create', '/123', '-other']) {
      expect(checkSource(surfaceUrls, `const url = '${path}${suffix}'`)).toHaveLength(1)
    }
    expect(checkSource(surfaceUrls, 'const url = `' + path + '${id}`')).toHaveLength(1)
    for (const expression of [`'${path}' + '/create'`, `'${path}' + '/' + id`, `'${path}'.concat('/create')`,
      '`${\'' + path + '\'}/create`']) {
      expect(checkSource(surfaceUrls, `const url = ${expression}`)).toHaveLength(1)
    }
  }
  expect(checkSource(surfaceUrls, "const url = '/collections/xp-events'")).toHaveLength(1)
})
