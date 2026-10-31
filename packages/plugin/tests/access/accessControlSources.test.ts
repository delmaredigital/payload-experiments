import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'
import { OVERRIDE_ACCESS_ALLOW_LIST } from './allowList.js'

const pluginRoot = fileURLToPath(new URL('../../', import.meta.url))
const methods = new Set([
  'find', 'findByID', 'findVersions', 'findVersionByID', 'restoreVersion',
  'count', 'countVersions', 'create', 'update', 'updateByID', 'delete', 'deleteByID',
  'duplicate', 'findGlobal', 'updateGlobal', 'findGlobalVersions',
  'findGlobalVersionByID', 'restoreGlobalVersion',
])
type Violation = { file: string; line: number; rule: string }

function matchesGlob(file: string, glob: string): boolean {
  const pattern = glob.split('**').map(part => part.split('*').map(
    literal => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'),
  ).join('[^/]*')).join('.*')
  return new RegExp(`^${pattern}$`).test(file)
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function scan(text: string, file: string, allowList = OVERRIDE_ACCESS_ALLOW_LIST): Violation[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const violations: Violation[] = []
  const report = (node: ts.Node, rule: string) => violations.push({
    file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, rule,
  })
  const allowed = allowList.some(entry => matchesGlob(file, entry.file))
  const inDb = file.startsWith('src/db/')
  // Bind this source alone: symbols distinguish same-named aliases in separate
  // scopes without loading dependencies or typechecking the scanned program.
  const options: ts.CompilerOptions = { noLib: true, noResolve: true }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = name => name === file ? source : undefined
  const checker = ts.createProgram([file], options, host).getTypeChecker()
  type Alias = { method: string; receiver: string }
  const aliases = new Map<ts.Symbol, Alias>()
  const setAlias = (name: ts.Identifier, alias: Alias) => {
    const symbol = checker.getSymbolAtLocation(name)
    if (symbol) aliases.set(symbol, alias)
  }
  const comments: Array<{ end: number; line: number }> = []
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, text)
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      comments.push({ end: scanner.getTextPos(), line: source.getLineAndCharacterOfPosition(scanner.getTextPos()).line })
    }
  }
  const unwrap = (expression: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) {
      expression = expression.expression
    }
    return expression
  }
  const nameOf = (name: ts.PropertyName | undefined): string | undefined => {
    if (!name) return undefined
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
    if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) return name.expression.text
    return undefined
  }
  const memberName = (expression: ts.Expression): string | undefined => {
    const node = unwrap(expression)
    if (ts.isPropertyAccessExpression(node)) return node.name.text
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text
    return undefined
  }
  const collectAliases = (node: ts.Node) => {
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && ts.isIdentifier(node.name)) {
      const method = nameOf(node.propertyName) ?? node.name.text
      const binding = node.parent.parent
      if (methods.has(method)) setAlias(node.name, {
        method,
        receiver: (ts.isVariableDeclaration(binding) || ts.isParameter(binding))
          ? binding.initializer?.getText(source) ?? '' : '',
      })
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const member = unwrap(node.initializer)
      const method = memberName(member) ?? ''
      if (methods.has(method) && (ts.isPropertyAccessExpression(member) || ts.isElementAccessExpression(member))) {
        setAlias(node.name, { method, receiver: member.expression.getText(source) })
      }
    }
    ts.forEachChild(node, collectAliases)
  }
  collectAliases(source)

  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      const symbol = ts.isIdentifier(callee) ? checker.getSymbolAtLocation(callee) : undefined
      const alias = symbol ? aliases.get(symbol) : undefined
      const method = memberName(callee) ?? alias?.method ?? ''
      const receiver = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
        ? callee.expression.getText(source) : alias?.receiver ?? ''
      const arg = node.arguments[0] && unwrap(node.arguments[0])
      const localApiShape = arg && ts.isObjectLiteralExpression(arg) && arg.properties.some(
        property => ['collection', 'slug'].includes(nameOf(property.name) ?? ''),
      )
      // Call shape identifies Local API calls on any receiver; a payload receiver
      // also catches options variables and malformed calls without a signature.
      if (methods.has(method) && (localApiShape || receiver.includes('payload'))) {
        if (!arg || !ts.isObjectLiteralExpression(arg)) {
          if (!allowed) report(node, 'local-api-nonliteral')
        } else {
          const properties = arg.properties.filter(property => nameOf(property.name) === 'overrideAccess')
          if (!properties.length) report(node, 'local-api-override-required')
          for (const property of properties) {
            if (ts.isPropertyAssignment(property) && unwrap(property.initializer).kind === ts.SyntaxKind.TrueKeyword) {
              if (!allowed) report(node, 'override-true-not-allowed')
              const start = node.getStart(source)
              const line = source.getLineAndCharacterOfPosition(start).line
              if (!comments.some(comment => comment.end <= start && line - comment.line <= 3)) {
                report(node, 'override-true-comment-required')
              }
            }
          }
        }
      }
    }
    if (!inDb) {
      // The receiver may be payload, req.payload, or a longer payload expression.
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && memberName(node.expression) === 'db') {
        const receiver = unwrap(node.expression)
        if ((ts.isPropertyAccessExpression(receiver) || ts.isElementAccessExpression(receiver)) &&
          (receiver.expression.getText(source) === 'payload' || memberName(receiver.expression) === 'payload')) {
          report(node, 'payload-db-outside-db')
        }
      }
      if (ts.isTaggedTemplateExpression(node) && (node.tag.getText(source) === 'sql' || memberName(node.tag) === 'sql')) {
        report(node, 'sql-tag-outside-db')
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
        /^(?:drizzle-orm|@payloadcms\/db-postgres\/drizzle)(?:\/|$)/.test(node.moduleSpecifier.text)) {
        report(node, 'drizzle-import-outside-db')
      }
      // Read the complete template, including interpolations, so SQL split over
      // template spans is checked too. Capitalisation intentionally matches §7.8.
      if ((ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) &&
        /\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*\b(FROM|INTO|SET|WHERE)\b/.test(
          ts.isTemplateExpression(node) ? node.getText(source) : node.text,
        )) report(node, 'sql-literal-outside-db')
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  return violations
}

describe('access and SQL source boundaries', () => {
  test('every src file states its access posture and keeps SQL inside src/db', () => {
    const violations = filesUnder(join(pluginRoot, 'src')).flatMap(path =>
      scan(readFileSync(path, 'utf8'), relative(pluginRoot, path).replaceAll('\\', '/')),
    )
    expect(violations, violations.map(v => `${v.file}:${v.line} ${v.rule}`).join('\n')).toEqual([])
  })

  const fixtures = [
    ['missingOverride.ts', 'local-api-override-required'],
    ['otherClient.ts', 'local-api-override-required'],
    ['nonliteral.ts', 'local-api-nonliteral'],
    ['unapprovedOverride.ts', 'override-true-not-allowed'],
    ['uncommentedOverride.ts', 'override-true-comment-required'],
    ['payloadDb.ts', 'payload-db-outside-db'],
    ['sqlTag.ts', 'sql-tag-outside-db'],
    ['drizzleImport.ts', 'drizzle-import-outside-db'],
    ['sqlLiteral.ts', 'sql-literal-outside-db'],
  ] as const
  test.each(fixtures)('%s proves %s fires', (fixture, rule) => {
    const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '_fixtures', fixture), 'utf8')
    const file = fixture === 'uncommentedOverride.ts' ? 'src/transitions/example.ts' : 'src/example.ts'
    expect(scan(text, file).map(v => v.rule)).toContain(rule)
  })

  test.each([...methods])('checks %s on every receiver and destructured aliases', method => {
    for (const receiver of ['payload', 'req.payload', '(await getPayload())', 'arbitraryReceiver']) {
      expect(scan(`${receiver}.${method}({ collection: 'xp-events' })`, 'src/example.ts')).toHaveLength(1)
    }
    expect(scan(`const { ${method}: alias } = payload; alias({})`, 'src/example.ts')).toHaveLength(1)
    expect(scan(`const alias = req.payload.${method}; alias({})`, 'src/example.ts')).toHaveLength(1)
    expect(scan(`someClient.${method}({ slug: 'xp-state' })`, 'src/example.ts')).toHaveLength(1)
    expect(scan(`payload.${method}(options)`, 'src/example.ts').map(v => v.rule)).toEqual(['local-api-nonliteral'])
    expect(scan(`payload.${method}({ overrideAccess: false })`, 'src/example.ts')).toEqual([])
  })

  test.each(['mapDelete.ts', 'hmacUpdate.ts', 'arrayFind.ts', 'setDelete.ts'])(
    '%s is not a Local API call', fixture => {
      const text = readFileSync(new URL(`./_fixtures/${fixture}`, import.meta.url), 'utf8')
      expect(scan(text, 'src/example.ts')).toEqual([])
    },
  )

  test('arbitrary receivers and aliases require a Local API argument shape', () => {
    expect(scan('someClient.find(args)', 'src/example.ts')).toEqual([])
    expect(scan('someClient.find({ overrideAccess: true })', 'src/example.ts')).toEqual([])
    expect(scan('const { find: alias } = someClient; alias({})', 'src/example.ts')).toEqual([])
    expect(scan("const { find: alias } = someClient; alias({ collection: 'x' })", 'src/example.ts').map(v => v.rule))
      .toEqual(['local-api-override-required'])
    expect(scan('const { find: alias } = payload; alias(args)', 'src/example.ts').map(v => v.rule))
      .toEqual(['local-api-nonliteral'])
  })

  test('same-named aliases in separate scopes keep their own receiver', () => {
    const payloadCall = 'function a() { const { find } = payload; find(args) }'
    const otherCall = 'function b() { const { find } = someClient; find(args) }'
    for (const text of [payloadCall + '\n' + otherCall, otherCall + '\n' + payloadCall]) {
      expect(scan(text, 'src/example.ts').map(v => v.rule)).toEqual(['local-api-nonliteral'])
    }
    expect(scan('const { find } = payload; function a(find) { find(args) }', 'src/example.ts')).toEqual([])
  })

  test('UI copy and ordinary literals do not look like SQL', () => {
    const text = readFileSync(new URL('./_fixtures/uiCopy.ts', import.meta.url), 'utf8')
    expect(scan(text, 'src/admin/example.tsx')).toEqual([])
  })

  test('the fixed allow-list accepts glob matches with a nearby comment', () => {
    expect(scan('// §7.8 transition writes plugin state.\npayload.update({ overrideAccess: true })', 'src/transitions/start.ts')).toEqual([])
    expect(scan('payload.update(options)', 'src/transitions/start.ts')).toEqual([])
    expect(scan('// reason\n\n\n\npayload.update({ overrideAccess: true })', 'src/transitions/start.ts').map(v => v.rule)).toContain('override-true-comment-required')
    expect(scan("payload.update({ ['overrideAccess']: false })", 'src/example.ts')).toEqual([])
  })

  test('SQL rules allow src/db and catch SQL split by template interpolation', () => {
    const text = 'import { sql } from "drizzle-orm"; payload.db.drizzle.execute(sql`SELECT * FROM xp_events`)'
    expect(scan(text, 'src/db/example.ts')).toEqual([])
    expect(scan('const query = `SELECT ${columns} FROM ${table}`', 'src/example.ts').map(v => v.rule)).toContain('sql-literal-outside-db')
    expect(scan('req.payload.db.drizzle.execute(query)', 'src/example.ts').map(v => v.rule)).toContain('payload-db-outside-db')
  })
})
