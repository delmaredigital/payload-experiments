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
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
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
  type Alias = { method: string; receiver: ts.Expression | undefined }
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
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
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
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text
    return undefined
  }
  const constructors = new Set(['Map', 'Set', 'WeakMap', 'WeakSet', 'URLSearchParams', 'Headers', 'FormData'])
  const builtinValue = (expression: ts.Expression): boolean => {
    const node = unwrap(expression)
    return ts.isArrayLiteralExpression(node) || (ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) && constructors.has(node.expression.text))
  }
  const cryptoCall = (expression: ts.Expression): boolean => {
    const node = unwrap(expression)
    if (!ts.isCallExpression(node)) return false
    const callee = unwrap(node.expression)
    if (ts.isIdentifier(callee)) return ['createHmac', 'createHash'].includes(callee.text)
    return (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) && cryptoCall(callee.expression)
  }
  const builtinReceiver = (expression: ts.Expression | undefined): boolean => {
    if (!expression) return false
    const node = unwrap(expression)
    if (builtinValue(node) || cryptoCall(node)) return true
    if (!ts.isIdentifier(node)) return false
    // Declaration syntax is the evidence, not inferred library types. Symbols
    // keep a same-named parameter or variable in another scope from matching.
    return checker.getSymbolAtLocation(node)?.declarations?.some(declaration =>
      ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.BlockScoped) !== 0 &&
      declaration.initializer !== undefined && builtinValue(declaration.initializer),
    ) ?? false
  }
  const nonLocalArgument = (arg: ts.Expression | undefined): boolean => !arg ||
    ts.isFunctionExpression(arg) || ts.isArrowFunction(arg) || ts.isStringLiteralLike(arg) ||
    ts.isNumericLiteral(arg) || ts.isTemplateExpression(arg) ||
    (ts.isPrefixUnaryExpression(arg) && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(arg.operator) && ts.isNumericLiteral(arg.operand))
  // A typed permissions value such as { update?: boolean | { permission?: boolean } }
  // is data. Unresolved, any and unknown types provide no such evidence.
  const nonCallableType = (type: ts.Type): boolean => type.isUnion()
    ? type.types.every(nonCallableType)
    : (type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike |
      ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0 ||
      ((type.flags & ts.TypeFlags.Object) !== 0 && type.getCallSignatures().length === 0)
  const nonCallableMember = (node: ts.Expression): boolean => nonCallableType(checker.getTypeAtLocation(node))
  const collectAliases = (node: ts.Node) => {
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && ts.isIdentifier(node.name)) {
      const method = nameOf(node.propertyName) ?? node.name.text
      const binding = node.parent.parent
      if (methods.has(method)) setAlias(node.name, {
        method,
        receiver: (ts.isVariableDeclaration(binding) || ts.isParameter(binding))
          ? binding.initializer : undefined,
      })
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const member = unwrap(node.initializer)
      const method = memberName(member) ?? ''
      if (methods.has(method) && (ts.isPropertyAccessExpression(member) || ts.isElementAccessExpression(member)) &&
        !nonCallableMember(member)) {
        setAlias(node.name, { method, receiver: member.expression })
      }
    }
    ts.forEachChild(node, collectAliases)
  }
  collectAliases(source)

  const sqlModule = (specifier: ts.Expression | undefined): boolean => specifier !== undefined &&
    ts.isStringLiteralLike(specifier) && /^(?:drizzle-orm|@payloadcms\/(?:db-postgres|drizzle))(?:\/|$)/.test(specifier.text)
  const typeOnlyImport = (clause: ts.ImportClause | undefined): boolean => clause !== undefined &&
    (clause.isTypeOnly || (!clause.name && clause.namedBindings !== undefined &&
      ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 &&
      clause.namedBindings.elements.every(element => element.isTypeOnly)))
  const typeOnlyExport = (node: ts.ExportDeclaration): boolean => node.isTypeOnly ||
    (node.exportClause !== undefined && ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.length > 0 && node.exportClause.elements.every(element => element.isTypeOnly))
  const outerExpression = (node: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent) ||
      ts.isSatisfiesExpression(node.parent) || ts.isTypeAssertionExpression(node.parent) || ts.isNonNullExpression(node.parent)) {
      node = node.parent
    }
    return node
  }
  const capturedOrInvoked = (node: ts.Expression): boolean => {
    const expression = outerExpression(node)
    const parent = expression.parent
    return (ts.isCallExpression(parent) && (parent.expression === expression ||
      (memberName(parent.expression) === 'apply' && parent.arguments[0] === expression))) ||
      (ts.isVariableDeclaration(parent) && parent.initializer === expression) ||
      (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.right === expression) ||
      ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
        ['call', 'apply', 'bind'].includes(memberName(parent) ?? ''))
  }
  const assignmentPattern = (pattern: ts.ObjectLiteralExpression): boolean => {
    let node: ts.Node = pattern
    while (ts.isParenthesizedExpression(node.parent) || ts.isObjectLiteralExpression(node.parent) ||
      ts.isArrayLiteralExpression(node.parent) || ts.isPropertyAssignment(node.parent) || ts.isSpreadElement(node.parent)) {
      node = node.parent
    }
    return ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.parent.left === node
  }

  const walk = (node: ts.Node) => {
    // Taking a suspect method as a value permits .call/.apply/.bind, Reflect.apply,
    // assignment aliases and wrapped callees. Refuse it even if a later call
    // cannot be resolved. Computed keys on unknown receivers stay suspect too.
    if (!allowed && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      !builtinReceiver(node.expression)) {
      const direct = ts.isCallExpression(node.parent) && node.parent.expression === node
      const computed = capturedOrInvoked(node) && ts.isElementAccessExpression(node) &&
        (ts.isNoSubstitutionTemplateLiteral(node.argumentExpression)
          ? methods.has(node.argumentExpression.text)
          : !ts.isStringLiteral(node.argumentExpression) && !ts.isNumericLiteral(node.argumentExpression))
      if (computed || (methods.has(memberName(node) ?? '') && !direct && !nonCallableMember(node))) {
        report(node, 'local-api-indirect')
      }
    }
    if (!allowed && ts.isIdentifier(node) && capturedOrInvoked(node)) {
      const symbol = checker.getSymbolAtLocation(node)
      const alias = symbol && aliases.get(symbol)
      if (alias && !builtinReceiver(alias.receiver) &&
        !(ts.isCallExpression(node.parent) && node.parent.expression === node)) report(node, 'local-api-indirect')
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      const symbol = ts.isIdentifier(callee) ? checker.getSymbolAtLocation(callee) : undefined
      const alias = symbol ? aliases.get(symbol) : undefined
      const method = memberName(callee) ?? alias?.method ?? ''
      const receiver = ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)
        ? callee.expression : alias?.receiver
      const arg = node.arguments[0] && unwrap(node.arguments[0])
      // Every matching method is suspect unless its argument or receiver syntax
      // proves it is outside the Local API. Unknown receivers stay suspect.
      if (methods.has(method) && !nonLocalArgument(arg) && !builtinReceiver(receiver)) {
        if (!arg || !ts.isObjectLiteralExpression(arg)) {
          if (!allowed) report(node, 'local-api-nonliteral')
        } else {
          if (!allowed && arg.properties.some(ts.isSpreadAssignment)) report(node, 'local-api-spread')
          const properties = arg.properties.filter(property => nameOf(property.name) === 'overrideAccess')
          if (!properties.length) report(node, 'local-api-override-required')
          for (const property of properties) {
            if (!allowed && !(ts.isPropertyAssignment(property) &&
              unwrap(property.initializer).kind === ts.SyntaxKind.FalseKeyword)) report(node, 'override-not-literal-false')
            if (ts.isPropertyAssignment(property) && unwrap(property.initializer).kind === ts.SyntaxKind.TrueKeyword) {
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
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && memberName(node) === 'db') {
        report(node, 'db-outside-db')
      }
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && !node.dotDotDotToken &&
        (nameOf(node.propertyName) ?? (ts.isIdentifier(node.name) ? node.name.text : undefined)) === 'db') {
        report(node, 'db-outside-db')
      }
      if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && nameOf(node.name) === 'db' &&
        ts.isObjectLiteralExpression(node.parent) && assignmentPattern(node.parent)) report(node, 'db-outside-db')
      if (ts.isTaggedTemplateExpression(node) && (node.tag.getText(source) === 'sql' || memberName(node.tag) === 'sql')) {
        report(node, 'sql-tag-outside-db')
      }
      if ((ts.isImportDeclaration(node) && sqlModule(node.moduleSpecifier) && !typeOnlyImport(node.importClause)) ||
        (ts.isExportDeclaration(node) && sqlModule(node.moduleSpecifier) && !typeOnlyExport(node)) ||
        (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference) &&
          sqlModule(node.moduleReference.expression)) ||
        (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && sqlModule(node.arguments[0]))) {
        report(node, 'sql-module-outside-db')
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
    ['objectNoCollection.ts', 'local-api-override-required'],
    ['nonliteral.ts', 'local-api-nonliteral'],
    ['variableClient.ts', 'local-api-nonliteral'],
    ['unapprovedOverride.ts', 'override-not-literal-false'],
    ['nonliteralOverride.ts', 'override-not-literal-false'],
    ['localApiSpread.ts', 'local-api-spread'],
    ['indirectLocalApi.ts', 'local-api-indirect'],
    ['uncommentedOverride.ts', 'override-true-comment-required'],
    ['payloadDb.ts', 'db-outside-db'],
    ['dbAccess.ts', 'db-outside-db'],
    ['sqlTag.ts', 'sql-tag-outside-db'],
    ['drizzleImport.ts', 'sql-module-outside-db'],
    ['sqlModules.ts', 'sql-module-outside-db'],
    ['sqlLiteral.ts', 'sql-literal-outside-db'],
  ] as const
  test.each(fixtures)('%s proves %s fires', (fixture, rule) => {
    const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '_fixtures', fixture), 'utf8')
    const file = fixture === 'uncommentedOverride.ts' ? 'src/transitions/example.ts' : 'src/example.ts'
    expect(scan(text, file).map(v => v.rule)).toContain(rule)
  })

  test.each([
    'overrideAccess', 'overrideAccess: flag', 'overrideAccess: !0', 'overrideAccess: req.context.trusted',
    'get overrideAccess() { return true }', 'overrideAccess() { return false }',
    'overrideAccess: true', 'overrideAccess: 0', 'overrideAccess: null',
  ])('requires literal false outside the allow-list: %s', property => {
    expect(scan(`payload.find({ ${property} })`, 'src/example.ts').map(v => v.rule))
      .toContain('override-not-literal-false')
  })

  test.each(['...options, overrideAccess: false', 'overrideAccess: false, ...options'])(
    'rejects spreads regardless of position: %s', properties => {
      const text = `payload.find({ ${properties} })`
      expect(scan(text, 'src/example.ts').map(v => v.rule)).toEqual(['local-api-spread'])
      expect(scan(text, 'src/transitions/example.ts')).toEqual([])
    },
  )

  test.each([
    'payload.find.call(payload, options)', 'payload.find.apply(payload, [options])',
    'const bound = payload.find.bind(payload); bound(options)', 'Reflect.apply(payload.find, payload, [options])',
    'payload[`find`]({ overrideAccess: false })', 'const m = "find"; payload[m](options)',
    'const m = "other"; payload[m](options)', 'const f = payload.find; f({ overrideAccess: false })',
    'let f; f = payload.find; f({ overrideAccess: false })',
    'const f = payload[m]; f(options)', 'let f; f = payload[m]; f(options)',
    '(payload[m] as any)(options)', '(payload[m] satisfies Function)(options)',
    'payload[m].call(payload, options)', 'Reflect.apply(payload[m], payload, [options])',
    'const { find } = payload; find.call(payload, options)',
    '(payload.find satisfies Function)({ overrideAccess: false })', '(payload.find as any)({ overrideAccess: false })',
    '(<Function>payload.find)({ overrideAccess: false })',
  ])('refuses indirect Local API access: %s', text => {
    expect(scan(text, 'src/example.ts').map(v => v.rule)).toContain('local-api-indirect')
  })

  test('typed non-callable method names are data; unknown and callable values stay suspect', () => {
    expect(scan(`
      type Permissions = { update?: boolean | { permission?: boolean } }
      function read(permissions: Permissions) { const update = permissions.update; return update }
    `, 'src/example.ts')).toEqual([])
    for (const type of ['any', 'unknown', '() => void']) {
      expect(scan(`declare const client: { find: ${type} }; const f = client.find`, 'src/example.ts').map(v => v.rule))
        .toContain('local-api-indirect')
    }
  })

  test.each([
    'const db = receiver.db', 'receiver["db"]', 'receiver[`db`]', '(await getPayload()).db',
    'const { db } = receiver', 'const { db: alias } = receiver', 'const { db: { execute } } = receiver',
    'function f({ db }: any) {}', 'const f = ({ db: alias }: any) => alias',
    'let db; ({ db } = receiver)', 'let alias; ({ db: alias } = receiver)',
    'let alias; ({ nested: { db: alias } } = receiver)',
  ])('keeps all db receivers and binding patterns inside src/db: %s', text => {
    expect(scan(text, 'src/example.ts').map(v => v.rule)).toContain('db-outside-db')
    expect(scan(text, 'src/db/example.ts')).toEqual([])
  })

  test('ordinary db object properties are not destructuring', () => {
    expect(scan('const value = { db: true }; other = { nested: { db: true } }', 'src/example.ts')).toEqual([])
  })

  test.each(['@payloadcms/db-postgres', '@payloadcms/db-postgres/drizzle', '@payloadcms/drizzle', 'drizzle-orm', 'drizzle-orm/pg-core'])(
    'blocks every value-loading form of SQL module %s outside src/db', module => {
      for (const text of [
        `import { sql as q } from '${module}'`, `import * as q from '${module}'`, `import '${module}'`,
        `export { sql as q } from '${module}'`, `export * from '${module}'`,
        `import('${module}')`, `require('${module}')`, `import q = require('${module}')`,
        `import { type SQL, sql } from '${module}'`, `export { type SQL, sql } from '${module}'`,
      ]) {
        expect(scan(text, 'src/example.ts').map(v => v.rule), text).toContain('sql-module-outside-db')
        expect(scan(text, 'src/db/example.ts'), text).toEqual([])
      }
      for (const text of [
        `import type { SQL } from '${module}'`, `import { type SQL } from '${module}'`,
        `export type { SQL } from '${module}'`, `export { type SQL } from '${module}'`,
        `export type * from '${module}'`, `type SQL = import('${module}').SQL`,
        `import type q = require('${module}')`,
      ]) expect(scan(text, 'src/example.ts'), text).toEqual([])
    },
  )

  test.each([...methods])('checks %s on every receiver and destructured aliases', method => {
    for (const receiver of ['payload', 'req.payload', '(await getPayload())', 'arbitraryReceiver']) {
      expect(scan(`${receiver}.${method}({ collection: 'xp-events' })`, 'src/example.ts')).toHaveLength(1)
    }
    expect(scan(`const { ${method}: alias } = payload; alias({})`, 'src/example.ts')).toHaveLength(1)
    expect(scan(`const alias = req.payload.${method}; alias({})`, 'src/example.ts').map(v => v.rule))
      .toEqual(['local-api-indirect', 'local-api-override-required'])
    expect(scan(`someClient.${method}({ slug: 'xp-state' })`, 'src/example.ts')).toHaveLength(1)
    expect(scan(`payload.${method}(options)`, 'src/example.ts').map(v => v.rule)).toEqual(['local-api-nonliteral'])
    expect(scan(`payload.${method}({ overrideAccess: false })`, 'src/example.ts')).toEqual([])
  })

  test.each(['mapDelete.ts', 'hmacUpdate.ts', 'arrayFind.ts', 'setDelete.ts', 'headersDelete.ts'])(
    '%s is not a Local API call', fixture => {
      const text = readFileSync(new URL(`./_fixtures/${fixture}`, import.meta.url), 'utf8')
      expect(scan(text, 'src/example.ts')).toEqual([])
    },
  )

  test('unknown receivers and aliases stay suspect without collection or slug', () => {
    expect(scan('someClient.find(args)', 'src/example.ts').map(v => v.rule)).toEqual(['local-api-nonliteral'])
    expect(scan('someClient.find({ overrideAccess: false })', 'src/example.ts')).toEqual([])
    expect(scan('const { find: alias } = someClient; alias({})', 'src/example.ts').map(v => v.rule))
      .toEqual(['local-api-override-required'])
    expect(scan("const { find: alias } = someClient; alias({ collection: 'x' })", 'src/example.ts').map(v => v.rule))
      .toEqual(['local-api-override-required'])
    expect(scan('const { find: alias } = payload; alias(args)', 'src/example.ts').map(v => v.rule))
      .toEqual(['local-api-nonliteral'])
  })

  test('same-named aliases in separate scopes keep their own receiver', () => {
    const payloadCall = 'function a() { const { delete: action } = payload; action(args) }'
    const otherCall = 'function b() { const entries = new Map(); const { delete: action } = entries; action(args) }'
    for (const text of [payloadCall + '\n' + otherCall, otherCall + '\n' + payloadCall]) {
      expect(scan(text, 'src/example.ts').map(v => v.rule)).toEqual(['local-api-nonliteral'])
    }
    expect(scan('const { find } = payload; function a(find) { find(args) }', 'src/example.ts')).toEqual([])
  })

  test.each(['Map', 'Set', 'WeakMap', 'WeakSet', 'URLSearchParams', 'Headers', 'FormData'])(
    '%s receivers are recognised from declaration syntax', constructor => {
      for (const declaration of ['const', 'let']) {
        expect(scan(`${declaration} entries = new ${constructor}(); entries.delete(key)`, 'src/example.ts')).toEqual([])
      }
      expect(scan(`new ${constructor}().delete(key)`, 'src/example.ts')).toEqual([])
    },
  )

  test('array and chained crypto receivers are known built-ins', () => {
    for (const text of [
      'const values = []; values.find(predicate)', 'let values = []; values.find(predicate)',
      '[].find(predicate)', 'createHmac(algorithm, key).update(message).update(chunk)',
      'createHash(algorithm).update(chunk)',
    ]) expect(scan(text, 'src/example.ts')).toEqual([])
  })

  test('built-in evidence does not leak across scopes or through arbitrary initialisers', () => {
    for (const text of [
      'const entries = new Map(); function f(entries) { entries.delete(key) }',
      'var entries = new Map(); entries.delete(key)',
      'const entries = client; entries.delete(key)',
      'const hmac = createHmac(algorithm, key); hmac.update(options)',
    ]) expect(scan(text, 'src/example.ts').map(v => v.rule)).toEqual(['local-api-nonliteral'])
  })

  test.each(['', '() => true', 'function () { return true }', "'key'", '0', '-1', '`key`', '`key${value}`'])(
    'argument %s proves a matching method is not Local API', argument => {
      expect(scan(`client.find(${argument})`, 'src/example.ts')).toEqual([])
    },
  )

  test.each(['query', '...args', 'true', 'null'])(
    'argument %s remains suspect on an unknown receiver', argument => {
      expect(scan(`client.update(${argument})`, 'src/example.ts').map(v => v.rule)).toEqual(['local-api-nonliteral'])
    },
  )

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
    expect(scan('req.payload.db.drizzle.execute(query)', 'src/example.ts').map(v => v.rule)).toContain('db-outside-db')
  })
})
