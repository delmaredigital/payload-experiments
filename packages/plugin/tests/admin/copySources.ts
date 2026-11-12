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
export const editorFiles = [...files(join(src, 'admin')), ...files(join(src, 'puck')), ...files(join(src, 'testSurface'))]
export const copyPaths = [...files(join(src, 'testSurface/copy')).filter(file => file.endsWith('.ts')),...files(join(src, 'admin/copy')).filter(file => file.endsWith('.ts')),
  join(src, 'testSurface/labels.ts'), join(src, 'puck/copy.ts'), join(src, 'puck/editor/copy.ts'), join(src, 'goals/picker/copy.ts')]
export const helperPaths = editorFiles.filter(file => file.endsWith('.ts') && !copyPaths.includes(file))

const copyProperties = new Set(['message', 'label', 'title', 'headline', 'detail', 'hint'])
const classNameHelpers = new Set(['className', 'classNames', 'clsx', 'cn', 'cx'])

/** Returned literals, defaults, variable values, Error messages and authored copy properties in every helper. */
export function helperStrings(source: string, path = ''): string[] {
  const file = ts.createSourceFile('copy.ts', source, ts.ScriptTarget.Latest, true)
  const result: string[] = []
  const seen = new Set<ts.Node>()
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
  function literals(root: ts.Node, proseOnly = false) {
    function visit(node: ts.Node) {
      // ADM-L5c: only this URL helper's /collections/ literals are admin paths, not copy.
      // Keep scanning its prose, and the same strings everywhere else.
      if (path === join(src, 'testSurface/surfaceUrls.ts') && (ts.isStringLiteralLike(node) || ts.isTemplateHead(node))
        && node.text.startsWith('/collections/')) return
      // A helper's path default is a Payload field path, like the JSX path attribute.
      if (ts.isParameter(node.parent) && ts.isIdentifier(node.parent.name) && node.parent.name.text === 'path'
        && ts.isStringLiteralLike(node) && /^[\w.[\]]+$/.test(node.text)) return
      // Imports and type syntax describe implementation, never rendered copy.
      if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isTypeNode(node)) return
      // Equality operands are discriminants, including inside returned expressions.
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) return
      // Inspect property values, never their identifier/string/computed keys.
      if (ts.isPropertyAssignment(node)) {
        // exp-orch ADM-57 ruling: the integration name is developer metadata, never copy.
        if ([join(src, 'puck/integration.ts'), join(src, 'puck/editor/integration.ts')].includes(path)
          && ts.isIdentifier(node.name) && node.name.text === 'name'
          && ts.isStringLiteral(node.initializer) && node.initializer.text === 'experiments') return
        visit(node.initializer); return
      }
      if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined
        // CSS helper arguments are class tokens; only fetch's first argument is a URL.
        if (name && classNameHelpers.has(name)) return
        if (name && urlReaders.has(name)) { node.arguments.slice(1).forEach(visit); return }
        // URLSearchParams.set/append's first argument is a query key.
        if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
          && queryBuilders.has(node.expression.expression.text) && ['set', 'append'].includes(node.expression.name.text)) {
          node.arguments.slice(1).forEach(visit); return
        }
      }
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        if ((!proseOnly || node.text.includes(' ') || /^[A-Z][a-z]+$/.test(node.text)) && !seen.has(node)) { seen.add(node); result.push(node.text) }
      }
      ts.forEachChild(node, visit)
    }
    visit(root)
  }
  function walk(node: ts.Node) {
    if (ts.isParameter(node) && node.initializer) literals(node.initializer)
    else if (ts.isVariableDeclaration(node) && node.initializer) {
      let value = node.initializer
      while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression
      // Bare variables also hold route fragments, import-map entries and field keys.
      if (ts.isArrayLiteralExpression(value) || ts.isObjectLiteralExpression(value)) literals(value, true)
      // Keep the existing return/property checks, plus defaults and Error constructors.
      ts.forEachChild(node, walk)
    }
    else if (ts.isReturnStatement(node) && node.expression) literals(node.expression)
    else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      node.parameters.forEach(parameter => { if (parameter.initializer) literals(parameter.initializer) })
      literals(node.body)
    }
    else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text.endsWith('Error')) node.arguments?.forEach(argument => literals(argument))
    else if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && copyProperties.has(node.name.text)) literals(node.initializer)
    else ts.forEachChild(node, walk)
  }
  walk(file)
  return result
}
