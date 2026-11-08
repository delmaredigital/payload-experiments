import { existsSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, test } from 'vitest'

const root = new URL('../../', import.meta.url)
const prefix = '@delmaredigital/payload-experiments'
const pkg: { exports: Record<string, string | { '@delmaredigital/source'?: string }> } =
  JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const parse = (text: string) => ts.createSourceFile('snippet.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

// Like entrypoints.test.ts: inspect named export declarations with the TS compiler,
// including type exports. The entrypoint suite separately forbids export * barrels.
function checkImports(markdown: string, file = 'README.md'): { count: number; failures: string[] } {
  let count = 0
  const failures: string[] = []
  for (const block of markdown.matchAll(/^[ \t]*(`{3,}|~{3,})(?:ts|tsx|typescript)(?:[ \t]+[^\r\n]*)?\r?\n([\s\S]*?)^[ \t]*\1[ \t]*\r?$/gm)) {
    const source = parse(block[2]!)
    const firstLine = markdown.slice(0, block.index! + block[0].indexOf('\n') + 1).split('\n').length
    for (const node of source.statements.filter(ts.isImportDeclaration)) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) continue
      const specifier = node.moduleSpecifier.text
      if (specifier !== prefix && !specifier.startsWith(`${prefix}/`)) continue
      count++
      const line = firstLine + source.getLineAndCharacterOfPosition(node.getStart(source)).line
      const context = `${file}:${line} ${specifier}`
      const entry = pkg.exports[specifier === prefix ? '.' : `.${specifier.slice(prefix.length)}`]
      const target = typeof entry === 'object' ? entry['@delmaredigital/source'] : undefined
      if (!target?.startsWith('./src/')) {
        failures.push(`${context}: specifier has no @delmaredigital/source condition in the exports map`)
        continue
      }
      const path = new URL(target, root)
      if (!existsSync(path)) { failures.push(`${context}: missing source entry ${target}`); continue }
      const exported = new Set(parse(readFileSync(path, 'utf8')).statements.flatMap(statement =>
        ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map(element => element.name.text) : []))
      const bindings = node.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const name of bindings.elements) {
          const imported = (name.propertyName ?? name.name).text
          if (!exported.has(imported)) failures.push(`${context}: missing export ${imported}`)
        }
      }
    }
  }
  const occurrences = [...markdown.matchAll(/\bfrom\s+['"]@delmaredigital\/payload-experiments(?:\/[^'"]*)?['"]/g)].length
  if (count !== occurrences) failures.push(`${file}: parsed ${count} package imports in TypeScript fences; found ${occurrences} from occurrences in the whole file`)
  if (!count) failures.push(`${file}: no package imports found in TypeScript fences`)
  return { count, failures }
}

// Measured in the scoped exports run: README 12 ms, REFERENCE 4 ms, fixtures 1 ms; each below 1/3 of the 5,000 ms cap.
// REFERENCE.md is the interim full reference (repo only) until the docs site exists.
test.each(['README.md', 'REFERENCE.md'])('%s imports exist on their public package entries', file => {
  const result = checkImports(readFileSync(new URL(file, root), 'utf8'), file)
  expect(result.count).toBeGreaterThan(0)
  expect(result.failures).toEqual([])
}, 5_000)

test('reports missing names, source conditions and skipped imports; accepts fence variants, aliases and types', () => {
  const fixture = (body: string) => `# Example\n\n\`\`\`typescript\n${body}\n\`\`\`\n`
  expect(checkImports(fixture(`import {\n  getAssignments as read, type Manifest, MissingName\n} from '${prefix}/rsc'`)).failures)
    .toEqual([`README.md:4 ${prefix}/rsc: missing export MissingName`])
  expect(checkImports(fixture(`import { Nope } from '${prefix}/missing'`)).failures)
    .toEqual([`README.md:4 ${prefix}/missing: specifier has no @delmaredigital/source condition in the exports map`])
  expect(checkImports(fixture(`import { getAssignments as read, type Manifest } from '${prefix}/rsc'`)).failures).toEqual([])
  const valid = `import { getAssignments as read, type Manifest } from '${prefix}/rsc'`
  for (const fence of ['```', '~~~']) {
    expect(checkImports(`  ${fence}tsx title=example\n  ${valid}\n  ${fence}\n`))
      .toEqual({ count: 1, failures: [] })
  }
  expect(checkImports(fixture(`import { Nope } from '${prefix}/puck/editor.css'`)).failures)
    .toEqual([`README.md:4 ${prefix}/puck/editor.css: specifier has no @delmaredigital/source condition in the exports map`])
  expect(checkImports(`${fixture(valid)}\n${valid}`).failures).toEqual([
    'README.md: parsed 1 package imports in TypeScript fences; found 2 from occurrences in the whole file',
  ])
  expect(checkImports('No imports').failures).toEqual(['README.md: no package imports found in TypeScript fences'])
}, 5_000)
