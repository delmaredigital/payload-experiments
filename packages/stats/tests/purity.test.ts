import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

const sourceDir = fileURLToPath(new URL('../src/', import.meta.url))
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

it('has no runtime or peer dependencies', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(pkg).not.toHaveProperty('dependencies')
  expect(pkg).not.toHaveProperty('peerDependencies')
})

it('uses only relative module specifiers and no ambient runtime capabilities', () => {
  const forbidden = /\b(?:process|console|Date|globalThis)\b|\bMath\.random\b|\brequire\s*\(|\bnode:/
  for (const path of files(sourceDir)) {
    const text = readFileSync(path, 'utf8')
    expect(text, path).not.toMatch(forbidden)
    if (!path.endsWith('.ts')) continue
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    function visit(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        expect(node.moduleSpecifier.text.startsWith('.'), path).toBe(true)
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = node.arguments[0]
        expect(specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.'), path).toBe(true)
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        expect(node.argument.literal.text.startsWith('.'), path).toBe(true)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
})
