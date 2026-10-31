import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'

function scan(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    return entry.isDirectory() ? scan(url) : /\.[cm]?[jt]sx?$/.test(entry.name) ? [fileURLToPath(url)] : []
  })
}
test('UI trees import public UI and Payload types only', () => {
  const violations: string[] = []
  for (const area of ['admin', 'client', 'puck', 'fields']) for (const file of scan(new URL(`../../src/${area}/`, import.meta.url))) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    function check(specifier: string, typeOnly = false) {
      if (specifier.startsWith('@payloadcms/ui') && !['@payloadcms/ui', '@payloadcms/ui/shared'].includes(specifier)
        || specifier.startsWith('@payloadcms/next') || specifier.startsWith('payload/dist') || /\.scss(?:$|[?#])/.test(specifier)
        || specifier === 'payload' && !typeOnly) violations.push(`${file}: ${specifier}`)
    }
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
  }
  expect(violations).toEqual([])
})
