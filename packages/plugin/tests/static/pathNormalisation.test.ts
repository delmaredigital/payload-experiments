import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'

function privatePathNormalisers(text: string): number[] {
  const source = ts.createSourceFile('source.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const lines: number[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'replace') {
      const receiver = node.expression.expression.getText(source)
      const pattern = node.arguments[0]
      // Scope to pathnames: trimming an API base URL is a different operation.
      if (/(?:\bpath|\bpathname|\b\w+Path(?:name)?)$/.test(receiver) && pattern && ts.isRegularExpressionLiteral(pattern)
        && pattern.text.includes('\\/') && pattern.text.includes('$')) {
        lines.push(source.getLineAndCharacterOfPosition(node.getStart()).line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return lines
}

test('only runtime/normalisePath.ts strips trailing slashes from pathnames', () => {
  const root = new URL('../../src/', import.meta.url)
  const violations = readdirSync(root, { recursive: true }).flatMap(name => {
    const relative = String(name)
    if (!/\.tsx?$/.test(relative) || relative === 'runtime/normalisePath.ts') return []
    const file = new URL(relative, root)
    return privatePathNormalisers(readFileSync(file, 'utf8')).map(line => `${fileURLToPath(file)}:${line}`)
  })
  expect(violations).toEqual([])
}, 30_000)

test.each([
  String.raw`request.nextUrl.pathname.replace(/\/$/, '')`,
  String.raw`pathname.replace(/\/+$/, '') || '/'`,
  String.raw`sourcePath.replace(/\/+?$/, '')`,
])('static scan catches private path normalization: %s', source => {
  expect(privatePathNormalisers(source)).toEqual([1])
})
