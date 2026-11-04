import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const src = fileURLToPath(new URL('../../src/', import.meta.url))
export function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
export const editorFiles = [...files(join(src, 'admin')), ...files(join(src, 'puck'))]
export const copyPaths = [...files(join(src, 'admin/copy')).filter(file => file.endsWith('.ts')),
  join(src, 'admin/labels.ts'), join(src, 'puck/copy.ts'), join(src, 'puck/editor/copy.ts')]
export const helperPaths = editorFiles.filter(file => file.endsWith('.ts') && !copyPaths.includes(file))

const copyProperties = new Set(['message', 'label', 'title', 'headline', 'detail', 'hint'])
const classNameHelpers = new Set(['className', 'classNames', 'clsx', 'cn', 'cx'])

/** Returned literals, thrown Error messages and authored copy properties in every helper. */
export function helperStrings(source: string): string[] {
  const file = ts.createSourceFile('copy.ts', source, ts.ScriptTarget.Latest, true)
  const result: string[] = []
  const urlReaders = new Set(['fetch'])
  const queryBuilders = new Set<string>()
  function implementation(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isNewExpression(node.initializer) && ts.isIdentifier(node.initializer.expression)
      && node.initializer.expression.text === 'URLSearchParams') queryBuilders.add(node.name.text)
    // Local request wrappers pass their first path parameter (or path callback) to fetch.
    if (ts.isFunctionDeclaration(node) && node.name && node.parameters[0] && ts.isIdentifier(node.parameters[0].name)) {
      const parameter = node.parameters[0].name.text
      const functionName = node.name.text
      function usesUrl(child: ts.Node) {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === 'fetch') {
          const url = child.arguments[0]
          if (url && (ts.isIdentifier(url) && url.text === parameter || ts.isCallExpression(url)
            && ts.isIdentifier(url.expression) && url.expression.text === parameter)) urlReaders.add(functionName)
        }
        ts.forEachChild(child, usesUrl)
      }
      if (node.body) usesUrl(node.body)
    }
    ts.forEachChild(node, implementation)
  }
  implementation(file)
  function literals(node: ts.Node) {
    // Imports and type syntax describe implementation, never rendered copy.
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isTypeNode(node)) return
    // Equality operands are discriminants, including inside returned expressions.
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) return
    // Inspect property values, never their identifier/string/computed keys.
    if (ts.isPropertyAssignment(node)) { literals(node.initializer); return }
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined
      // CSS helper arguments are class tokens; only fetch's first argument is a URL.
      if (name && classNameHelpers.has(name)) return
      if (name && urlReaders.has(name)) { node.arguments.slice(1).forEach(literals); return }
      // URLSearchParams.set/append's first argument is a query key.
      if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
        && queryBuilders.has(node.expression.expression.text) && ['set', 'append'].includes(node.expression.name.text)) {
        node.arguments.slice(1).forEach(literals); return
      }
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) result.push(node.text)
    ts.forEachChild(node, literals)
  }
  function walk(node: ts.Node) {
    if (ts.isReturnStatement(node) && node.expression) literals(node.expression)
    else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) literals(node.body)
    else if (ts.isThrowStatement(node) && ts.isNewExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Error') node.expression.arguments?.forEach(literals)
    else if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && copyProperties.has(node.name.text)) literals(node.initializer)
    else ts.forEachChild(node, walk)
  }
  walk(file)
  return result
}
