import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const statsPackage = '@delmaredigital/experiments-stats'
// Relative imports of these non-code assets are leaves: recorded in `files`, never parsed.
const ASSET_LEAF = /\.(?:css|scss|sass|svg|png|jpe?g|gif|webp|json)$/i
const statsEntry = fileURLToPath(new URL('../../../stats/src/index.ts', import.meta.url))

/** Value edges by default; source-inventory checks may also follow erased type edges.
 * Dynamic specifiers are reported separately and also walked. */
export function collectImports(entryFile: string, { includeTypes = false }: { includeTypes?: boolean } = {}): { bare: string[]; files: string[]; dynamic: string[] } {
  const bare = new Set<string>(), files = new Set<string>(), dynamic = new Set<string>()
  const options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
  function visit(file: string) {
    file = resolve(file)
    if (files.has(file)) return
    files.add(file)
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    function edge(specifier: string, isDynamic = false) {
      if (isDynamic) dynamic.add(specifier)
      if (!specifier.startsWith('.')) {
        if (!isDynamic) bare.add(specifier)
        if (specifier === statsPackage) visit(statsEntry)
        return
      }
      if (ASSET_LEAF.test(specifier)) { files.add(resolve(dirname(file), specifier)); return }
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
      if (!resolved) throw new Error(`Unresolved import ${specifier} from ${file}`)
      visit(resolved.resolvedFileName)
    }
    function walk(node: ts.Node) {
      if (file.endsWith('.tsx') && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))) bare.add('react/jsx-runtime')
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause
        const bindings = clause?.namedBindings
        const onlyTypeNames = bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly)
        if (includeTypes || !clause?.isTypeOnly && !(onlyTypeNames && !clause?.name)) edge(node.moduleSpecifier.text)
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const names = node.exportClause
        const onlyTypeNames = names && ts.isNamedExports(names) && names.elements.length > 0 && names.elements.every(item => item.isTypeOnly)
        if (includeTypes || !node.isTypeOnly && !onlyTypeNames) edge(node.moduleSpecifier.text)
      } else if (ts.isImportEqualsDeclaration(node) && (includeTypes || !node.isTypeOnly) && ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression
        if (expression && ts.isStringLiteral(expression)) edge(expression.text)
      } else if (includeTypes && ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        edge(node.argument.literal.text)
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0]
        if (argument && ts.isStringLiteralLike(argument)) edge(argument.text, true)
        else dynamic.add(`<non-literal import in ${file}>`)
      }
      ts.forEachChild(node, walk)
    }
    walk(source)
  }
  visit(resolve(entryFile))
  return { bare: [...bare].sort(), files: [...files].sort(), dynamic: [...dynamic].sort() }
}
