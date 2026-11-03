import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'

// Allowed context keys are a naming rule, not a value check: reviewers must not
// log request data under an allowed key.
const pluginRoot = fileURLToPath(new URL('../../', import.meta.url))
const levels = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
const consoleLevels = new Set(['error', 'warn', 'log', 'info', 'debug', 'trace', 'dir', 'table', 'assert', 'count', 'group', 'timeLog'])
const contextKeys = new Set(['experimentId', 'snapshotId', 'metricId', 'flagPoint', 'slug', 'collection', 'id', 'phase', 'operation'])

// Reviewed string parameters, bound by declaration (not merely by identifier text).
// insertEvents emits only its fixed dropped-event diagnostic, never the row.
const callbackAllowList = [
  { file: 'src/endpoints/events.ts', parameter: 'message', owner: 'insertEvents', reason: 'Fixed dropped-event text.' },
  { file: 'src/server/recordExposures.ts', parameter: 'message', owner: 'insertEvents', reason: 'Fixed dropped-event text.' },
  { file: 'src/server/trackConversion.ts', parameter: 'message', owner: 'insertEvents', reason: 'Fixed dropped-event text.' },
  { file: 'src/hooks/hostHook.ts', parameter: 'name', owner: 'neverThrow', reason: 'Plugin hook label supplied by contentChanges.ts.' },
  { file: 'src/hooks/hostHook.ts', parameter: 'name', owner: 'neverThrowBefore', reason: 'Plugin baseline hook label supplied by contentChanges.ts.' },
  { file: 'src/client/beacon.ts', parameter: 'message', owner: 'warnOnce', reason: 'Existing client string-only diagnostics; no error objects.' },
  { file: 'src/manifest/compile.ts', parameter: 'slug', owner: 'onInvalid', reason: 'Manifest experiment slug is allowed context.' },
  { file: 'src/manifest/compile.ts', parameter: 'reason', owner: 'onInvalid', reason: 'Fixed untyped-targeting-rule diagnostic, not an error.' },
]

type Violation = { file: string; line: number; rule: string }
function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function scan(text: string, file: string): Violation[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const options: ts.CompilerOptions = { noLib: true, noResolve: true }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = name => name === file ? source : undefined
  const checker = ts.createProgram([file], options, host).getTypeChecker()
  const violations: Violation[] = []
  const report = (node: ts.Node, rule: string) => violations.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, rule })
  const unwrap = (value: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isTypeAssertionExpression(value) || ts.isNonNullExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression
    return value
  }
  const key = (name: ts.PropertyName): string | undefined => {
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
    if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text
    return undefined
  }
  const member = (value: ts.Expression): { receiver: ts.Expression; name?: string } | undefined => {
    value = unwrap(value)
    if (ts.isPropertyAccessExpression(value)) return { receiver: unwrap(value.expression), name: value.name.text }
    if (ts.isElementAccessExpression(value)) return { receiver: unwrap(value.expression), name: ts.isStringLiteralLike(value.argumentExpression) ? value.argumentExpression.text : undefined }
    return undefined
  }
  const isLogger = (value: ts.Expression): boolean => {
    value = unwrap(value)
    return (ts.isIdentifier(value) && value.text === 'logger') || member(value)?.name === 'logger' ||
      (ts.isCallExpression(value) && member(value.expression)?.name === 'child' && isLogger(member(value.expression)!.receiver))
  }
  const isConsole = (value: ts.Expression): boolean => (ts.isIdentifier(unwrap(value)) && unwrap(value).getText(source) === 'console') || member(value)?.name === 'console'
  const isProcessStream = (value: ts.Expression): boolean => {
    const access = member(value)
    return !!access && (access.name === 'stderr' || access.name === 'stdout') &&
      ((ts.isIdentifier(access.receiver) && access.receiver.text === 'process') ||
        (member(access.receiver)?.name === 'process' && member(access.receiver)!.receiver.getText(source) === 'globalThis'))
  }
  const loggingMethod = (value: ts.Expression): boolean => {
    const access = member(value)
    return !!access && ((isLogger(access.receiver) && (access.name === undefined || access.name === 'child' || levels.has(access.name))) ||
      (isConsole(access.receiver) && (access.name === undefined || consoleLevels.has(access.name))) ||
      (isProcessStream(access.receiver) && (access.name === undefined || access.name === 'write')))
  }
  const identifierSymbol = (value: ts.Identifier) => ts.isShorthandPropertyAssignment(value.parent)
    ? checker.getShorthandAssignmentValueSymbol(value.parent) : checker.getSymbolAtLocation(value)
  const safeImport = (declaration: ts.Declaration): boolean => {
    if (!ts.isImportSpecifier(declaration) || (declaration.propertyName ?? declaration.name).text !== 'safeError') return false
    const imported = declaration.parent.parent.parent
    return ts.isImportDeclaration(imported) && ts.isStringLiteral(imported.moduleSpecifier) &&
      normalize(join(dirname(file), imported.moduleSpecifier.text)).replaceAll('\\', '/').replace(/\.js$/, '.ts') === 'src/log.ts'
  }
  const safeCall = (value: ts.Expression): boolean => {
    value = unwrap(value)
    return ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === 'safeError' && value.arguments.length === 1 &&
      !!identifierSymbol(value.expression)?.declarations?.some(safeImport)
  }
  const catchBound = (value: ts.Identifier): boolean => {
    return !!identifierSymbol(value)?.declarations?.some(declaration => {
      let binding: ts.Node = declaration
      while (ts.isBindingElement(binding) || ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) binding = binding.parent
      if (ts.isVariableDeclaration(binding) && ts.isCatchClause(binding.parent)) return true
      if (!ts.isParameter(binding)) return false
      const fn = binding.parent
      if ((!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) || fn.parameters[0] !== binding) return false
      let callback: ts.Node = fn
      while (ts.isExpression(callback.parent) && unwrap(callback.parent) === fn) callback = callback.parent
      const call = callback.parent
      if (!ts.isCallExpression(call)) return false
      const method = member(call.expression)?.name
      return (method === 'catch' && call.arguments.length === 1 && call.arguments[0] === callback) ||
        (method === 'then' && call.arguments[1] === callback)
    })
  }
  const assignments = new Map<ts.Symbol, ts.Expression[]>()
  const isAssignment = (node: ts.Node): node is ts.BinaryExpression => ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  const collectAssignments = (node: ts.Node): void => {
    if (isAssignment(node) && ts.isIdentifier(unwrap(node.left))) {
      const symbol = identifierSymbol(unwrap(node.left) as ts.Identifier)
      if (symbol) assignments.set(symbol, [...(assignments.get(symbol) ?? []), node.right])
    }
    ts.forEachChild(node, collectAssignments)
  }
  collectAssignments(source)
  const tainted = (node: ts.Node, visited = new Set<ts.Symbol>()): boolean => {
    // Follow values returned by inline functions, including IIFEs and promise
    // callbacks. Merely inspecting an error in a callback does not return it.
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (!ts.isBlock(node.body)) return tainted(node.body, visited)
      const returnedTaint = (child: ts.Node): boolean => {
        if (ts.isReturnStatement(child)) return !!child.expression && tainted(child.expression, visited)
        if (ts.isFunctionLike(child)) return false
        return ts.forEachChild(child, descendant => returnedTaint(descendant) || undefined) ?? false
      }
      return returnedTaint(node.body)
    }
    // Sanitization ends taint only for a sole, direct identifier argument.
    if (ts.isCallExpression(node) && safeCall(node) && ts.isIdentifier(unwrap(node.arguments[0]!))) return false
    if (ts.isIdentifier(node)) {
      if (catchBound(node)) return true
      const symbol = identifierSymbol(node)
      if (!symbol || visited.has(symbol)) return false
      const next = new Set(visited).add(symbol)
      const initializers = (symbol.declarations ?? []).flatMap(declaration => {
        const values: ts.Expression[] = []
        let binding: ts.Node = declaration
        while (ts.isBindingElement(binding) || ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) {
          if (ts.isBindingElement(binding) && binding.initializer) values.push(binding.initializer)
          binding = binding.parent
        }
        if (ts.isVariableDeclaration(binding) && binding.initializer) values.push(binding.initializer)
        return values
      })
      return [...initializers, ...(assignments.get(symbol) ?? [])].some(value => tainted(value, next))
    }
    return ts.forEachChild(node, child => tainted(child, visited) || undefined) ?? false
  }
  const checkCatchReferences = (node: ts.Node): void => {
    // Only a direct safeError(catchBindingOrAlias) may consume the raw caught value.
    if (ts.isCallExpression(node) && safeCall(node) && ts.isIdentifier(unwrap(node.arguments[0]!))) return
    if (ts.isIdentifier(node) && tainted(node)) report(node, 'catch-bound-log-value')
    ts.forEachChild(node, checkCatchReferences)
  }
  const contextValue = (value: ts.Expression): boolean => {
    value = unwrap(value)
    if (ts.isIdentifier(value) || ts.isStringLiteralLike(value) || ts.isNumericLiteral(value) || ts.isBigIntLiteral(value) ||
      value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword || value.kind === ts.SyntaxKind.NullKeyword) return true
    if (ts.isElementAccessExpression(value) && (ts.isStringLiteralLike(value.argumentExpression) || ts.isNumericLiteral(value.argumentExpression))) return contextValue(value.expression)
    const access = member(value)
    return !!access && access.name !== undefined && (ts.isIdentifier(access.receiver) || !!member(access.receiver) && contextValue(access.receiver))
  }
  const allowedParameter = (value: ts.Identifier): boolean => {
    const symbol = identifierSymbol(value)
    const declaration = symbol?.valueDeclaration
    if (!declaration || !ts.isParameter(declaration) || !ts.isIdentifier(declaration.name)) return false
    const fn = declaration.parent
    let owner: string | undefined
    if (ts.isFunctionDeclaration(fn)) owner = fn.name?.text
    else if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
      const parent = fn.parent
      if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.arguments.at(-1) === fn) owner = parent.expression.text
      if (ts.isPropertyAssignment(parent) && key(parent.name) === 'onInvalid') owner = 'onInvalid'
    }
    return callbackAllowList.some(entry => entry.file === file && entry.parameter === declaration.name.getText(source) && entry.owner === owner)
  }
  const stringValue = (value: ts.Expression): boolean => {
    value = unwrap(value)
    if (ts.isStringLiteralLike(value)) return true
    if (ts.isIdentifier(value)) return allowedParameter(value)
    if (ts.isTemplateExpression(value)) return value.templateSpans.every(span => ts.isStringLiteralLike(unwrap(span.expression)) ||
      (ts.isIdentifier(unwrap(span.expression)) && allowedParameter(unwrap(span.expression) as ts.Identifier)))
    return false
  }
  const checkArgument = (argument: ts.Expression) => {
    checkCatchReferences(argument)
    const value = unwrap(argument)
    if (safeCall(value) || stringValue(value)) return
    if (!ts.isObjectLiteralExpression(value)) { report(argument, 'unsafe-log-argument'); return }
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) { report(property, 'unsafe-log-property'); continue }
      const name = key(property.name)
      const initializer = ts.isPropertyAssignment(property) ? property.initializer : property.name
      if (name === 'err' || name === 'error') {
        if (!safeCall(initializer)) report(property, 'raw-log-error')
        if (name === 'error') report(property, 'log-context-key')
      } else if (name === 'msg') {
        if (!ts.isStringLiteralLike(unwrap(initializer))) report(property, 'log-message-literal')
      } else if (!name || !contextKeys.has(name)) {
        // Rule 3 preserves this exact string-only manifest callback, including reason.
        if (!(file === 'src/manifest/compile.ts' && name === 'reason' && ts.isIdentifier(initializer) && allowedParameter(initializer))) report(property, 'log-context-key')
      } else if (!contextValue(initializer)) {
        report(property, 'unsafe-log-context-value')
      }
    }
  }
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && loggingMethod(node.expression)) node.arguments.forEach(checkArgument)
    if (ts.isIdentifier(node) && node.text === 'safeError') {
      const declarations = identifierSymbol(node)?.declarations ?? []
      for (const declaration of declarations) {
        const ownDefinition = file === 'src/log.ts' && ts.isFunctionDeclaration(declaration) && declaration.name === node
        if ((declaration as ts.NamedDeclaration).name === node && !safeImport(declaration) && !ownDefinition) report(node, 'untrusted-safeError-binding')
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer && (isLogger(node.initializer) || isConsole(node.initializer))) report(node, 'logger-alias')
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && (isLogger(node.right) || isConsole(node.right))) report(node, 'logger-alias')
    if (ts.isBindingElement(node)) {
      const name = key(node.propertyName ?? node.name as ts.PropertyName)
      if (name === 'logger' && (!ts.isIdentifier(node.name) || node.name.text !== 'logger')) report(node, 'logger-alias')
      if ((levels.has(name ?? '') || consoleLevels.has(name ?? '')) && ts.isObjectBindingPattern(node.parent)) {
        const parent = node.parent.parent
        if (ts.isVariableDeclaration(parent) && parent.initializer && (isLogger(parent.initializer) || isConsole(parent.initializer))) report(node, 'logger-method-reference')
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      // Unwrap casts/parentheses before deciding if a method is called directly.
      let usage: ts.Node = node
      while (ts.isExpression(usage.parent) && unwrap(usage.parent) === node) usage = usage.parent
      if (loggingMethod(node) && !(ts.isCallExpression(usage.parent) && usage.parent.expression === usage)) {
        // insertEvents' default sink receives its one fixed literal diagnostic.
        const parent = usage.parent
        const fixedDefault = file === 'src/db/events.ts' && ts.isParameter(parent) && parent.name.getText(source) === 'log' &&
          ts.isFunctionDeclaration(parent.parent) && parent.parent.name?.text === 'insertEvents' && node.getText(source) === 'console.error'
        if (!fixedDefault) report(node, 'logger-method-reference')
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  return violations
}

describe('logging source boundary', () => {
  test('every src log sanitizes errors and uses reviewed context', () => {
    const violations = filesUnder(join(pluginRoot, 'src')).flatMap(path => scan(readFileSync(path, 'utf8'), relative(pluginRoot, path).replaceAll('\\', '/')))
    expect(violations, violations.map(v => `${v.file}:${v.line} ${v.rule}`).join('\n')).toEqual([])
  }, 30_000)

  test.each([
    'payload.logger.error(error)', 'req.payload.logger.warn(error.message)', 'logger.info(data)',
    'console.error("x", error)', 'console.log(`failure: ${error}`)', 'payload.logger.error({ err: error })',
    'payload.logger.error({ error: error })', 'console.error({ err: error.cause })',
    'logger.error({ err: safeError(error), unitId })', 'logger.error({ userId })', 'logger.warn({ idempotencyKey })',
    'logger.error({ email })', 'logger.error({ body })', 'logger.error({ ...context })',
    'logger.error({ [key]: value })', 'logger.error({ msg: message })', 'logger.error({ msg: `x ${error}` })',
    'const log = payload.logger; log.error(error)', 'let log; log = req.payload.logger',
    'const { logger: log } = payload', 'const error = payload.logger.error', 'rows.forEach(payload.logger.error)',
    'const { error: report } = logger', 'const { log } = console',
    '(payload.logger.error as Function)(error)', 'payload["logger"]["error"](error)', 'console["error"](error)',
    'payload.logger[level](error)', 'console[level](error)', 'logger.error(...args)', 'logger.error(format(error))',
    'console.dir(error)', 'console.table(error)', 'console.assert(false, error)', 'globalThis.console.error(error)',
    'logger.child({}).error(error)', 'payload.logger.child({}).warn(error)',
    'process.stderr.write(String(error))', 'process.stdout.write(error.message)',
    'globalThis.process.stderr.write(String(error))', 'globalThis.process.stdout.write(error.message)',
    'console.count(error)', 'console.group(error)', 'console.timeLog("timer", error)',
    'const c = console; c.error(error)', 'let c; c = globalThis.console',
    'const safeError = e => e; logger.error({ err: safeError(error) })',
    'function safeError(e) { return e }; logger.error({ err: safeError(error) })',
    'import { safeError } from "./other.js"; logger.error({ err: safeError(error) })',
    'import safeError from "./log.js"; logger.error({ err: safeError(error) })',
    'function f(safeError) { logger.error({ err: safeError(error) }) }',
    'insertEvents(exec, rows, message => payload.logger.error(message))',
  ])('rejects unsafe snippet: %s', text => expect(scan(text, 'src/example.ts').length).toBeGreaterThan(0))

  test.each([
    'payload.logger.error({ err: safeError(error), experimentId }, "Failure")',
    'req.payload.logger.warn({ err: safeError(error), snapshotId, metricId, flagPoint, slug, collection, id, phase, operation }, "Failure")',
    'const { logger } = payload; logger.error({ err: safeError(error) }, "Failure")',
    'console.error("Failure", safeError(error))', 'console.warn("Fixed warning")', 'logger?.debug("Fixed debug")',
    'logger.error({ msg: "Fixed", err: safeError(error) })', 'logger.error({ ["err"]: safeError(error) })',
    '(payload.logger.error as Function)({ err: safeError(error) }, "Failure")',
    'try {} catch (error) { logger.error({ err: safeError(error), experimentId: id }, "Failure") }',
    'try {} catch (caught) { console.error(safeError(caught)) }',
    'logger.child({}).info("Fixed")', 'globalThis.console.dir({ id })',
    'process.stderr.write("Fixed")', 'process.stdout.write("Fixed")',
    'globalThis.process.stderr.write("Fixed")', 'globalThis.process.stdout.write("Fixed")',
    'console.count("Fixed")', 'console.group("Fixed")', 'console.timeLog("timer", "Fixed")',
    'logger.info({ id: doc.id, experimentId: docs[0].id, phase: 1, operation: "save" })',
  ])('accepts safe snippet: %s', text => expect(scan(`import { safeError } from './log.js';\n${text}`, 'src/example.ts')).toEqual([]))

  test.each([
    'try {} catch (error) { logger.error({ id: error }, "x") }',
    'try {} catch (error) { logger.error({ slug: error.message, experimentId: String(error) }, "x") }',
    'try {} catch (error) { logger.error({ operation: `${error}` }, "x") }',
    'try {} catch (caught) { logger.error({ id: caught }, "x") }',
    'try {} catch (id) { logger.error({ id }, "x") }',
    'try {} catch ({ message: id }) { logger.error({ id }, "x") }',
    'try {} catch (error) { logger.error({ err: safeError(error), id: error }, "x") }',
    'try {} catch (error) { logger.error({ err: safeError(error.message) }, "x") }',
    'try {} catch (error) { logger.error({ err: safeError(JSON.stringify(error)) }, "x") }',
    'try {} catch (error) { logger.child({ id: error }).error("Fixed") }',
    'logger.error({ id: String(value) }, "x")',
    'logger.error({ slug: `${value}` }, "x")',
    'logger.error({ id: get().id }, "x")',
  ])('rejects unsafe context values with the real sanitizer imported: %s', text => {
    expect(scan(`import { safeError } from './log.js';\n${text}`, 'src/example.ts').length).toBeGreaterThan(0)
  })

  test.each([
    'const e2 = error; logger.error({ id: e2 })',
    'const m = error.message; logger.error({ slug: m })',
    'const { detail } = error; logger.error({ id: detail })',
    'let x; x = error; logger.error({ id: x })',
    'const pgError = error as { detail?: string }; logger.error({ err: safeError(error), id: pgError.detail })',
    'const reason = error instanceof Error ? error.message : "x"; logger.error({ operation: reason })',
    'const first = error; const second = first; logger.error({ id: second })',
    'const { cause: { detail } } = error; logger.error({ id: detail })',
    'const [detail] = error; logger.error({ id: detail })',
    'const { detail = error } = {}; logger.error({ id: detail })',
    'const [detail = error] = []; logger.error({ id: detail })',
    'const { cause: { detail } = error } = {}; logger.error({ id: detail })',
    'let first = second; let second = first || error; logger.error({ id: first })',
    'const alias = (() => error)(); logger.error({ id: alias })',
    'const alias = await Promise.resolve().then(() => error); logger.error({ id: alias })',
  ])('rejects tainted catch aliases: %s', body => {
    const text = `import { safeError } from './log.js'; try {} catch (error) { ${body} }`
    expect(scan(text, 'src/example.ts').some(v => v.rule === 'catch-bound-log-value')).toBe(true)
  })

  test.each([
    'promise.catch(e => logger.error({ id: e }))',
    'promise.catch(e => logger.error({ err: safeError(e), slug: e.message }))',
    'promise.catch(function (e) { logger.error({ id: e.detail }) })',
    'promise.then(null, e => logger.error({ id: e }))',
    'promise.then(onSuccess, function ({ detail }) { logger.error({ id: detail }) })',
    'promise.catch((e => { const alias = e; logger.error({ id: alias }) }) as Function)',
    'const alias = await promise.catch(e => e); logger.error({ id: alias })',
  ])('rejects rejection callback values: %s', text => {
    expect(scan(`import { safeError } from './log.js'; ${text}`, 'src/example.ts').some(v => v.rule === 'catch-bound-log-value')).toBe(true)
  })

  // Known gaps (CORE-35b, briefed only if src grows such a site): a named rejection handler
  // (`promise.catch(handler)`), `Promise.allSettled` results logged as `r.reason`, taint through
  // callback parameters (`[error].forEach(x => log(x))`) and through property stores
  // (`obj.d = error`). Storing an error to rethrow it or hand it to `pool.release` is legitimate
  // and deliberately not reported; only its use inside a log call is.
  test.each([
    'try {} catch (error) { const alias = error; logger.error({ err: safeError(alias) }) }',
    'promise.catch(e => logger.error({ err: safeError(e) }))',
    'promise.then(null, e => logger.error({ err: safeError(e) }))',
    'try {} catch (error) { const alias = safeError(error); logger.info({ id: alias.name }) }',
    'let outer; try {} catch (error) { outer = safeError(error) }',
    'const first = second; const second = first; logger.info({ id: first })',
    'promise.then(e => logger.info({ id: e }))',
    'promise.catch(e => { function report(e) { logger.info({ id: e }) } })',
  ])('accepts sanitized aliases and unrelated bindings: %s', text => {
    expect(scan(`import { safeError } from './log.js'; ${text}`, 'src/example.ts')).toEqual([])
  })

  test('catch references bind to the declaration rather than the identifier text', () => {
    const text = 'try {} catch (error) { function report(error) { logger.error({ id: error }, "x") } }'
    expect(scan(text, 'src/example.ts')).toEqual([])
  })

  test.each([
    'const safeError = e => e', 'function safeError(e) { return e }',
    'import { safeError } from "./other.js"', 'import { other as safeError } from "./log.js"',
  ])('rejects an untrusted safeError declaration even without a log: %s', text => {
    expect(scan(text, 'src/example.ts').some(violation => violation.rule === 'untrusted-safeError-binding')).toBe(true)
  })

  test('reviewed string parameters are tied to the right declaration and file', () => {
    const text = 'insertEvents(exec, rows, message => payload.logger.error(message))'
    expect(scan(text, 'src/server/recordExposures.ts')).toEqual([])
    expect(scan('other(exec, rows, message => payload.logger.error(message))', 'src/server/recordExposures.ts').length).toBeGreaterThan(0)
    expect(scan('insertEvents(exec, rows, message => { function f(message) { payload.logger.error(message) } })', 'src/server/recordExposures.ts').length).toBeGreaterThan(0)
    expect(scan('import { safeError } from "../log.js"; function neverThrow(name: string) { console.error(`hook ${name}`, safeError(error)) }', 'src/hooks/hostHook.ts')).toEqual([])
    expect(scan('function neverThrow(name: string) { console.error(`hook ${error}`, safeError(error)) }', 'src/hooks/hostHook.ts').length).toBeGreaterThan(0)
  })

  test('the fixed manifest callback and insertEvents default have narrow exceptions', () => {
    const text = 'const options = { onInvalid: (slug, reason) => payload.logger.warn({ slug, reason }, "Omitted") }'
    expect(scan(text, 'src/manifest/compile.ts')).toEqual([])
    expect(scan(text, 'src/example.ts').length).toBeGreaterThan(0)
    expect(scan('payload.logger.warn({ slug, reason }, "Omitted")', 'src/manifest/compile.ts').length).toBeGreaterThan(0)
    expect(scan('function insertEvents(exec, rows, log = console.error) {}', 'src/db/events.ts')).toEqual([])
    expect(scan('function other(exec, rows, log = console.error) {}', 'src/db/events.ts').length).toBeGreaterThan(0)
  })
})
