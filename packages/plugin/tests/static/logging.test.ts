import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'

const pluginRoot = fileURLToPath(new URL('../../', import.meta.url))
const levels = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
const consoleLevels = new Set(['error', 'warn', 'log', 'info', 'debug', 'trace'])
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
    return (ts.isIdentifier(value) && value.text === 'logger') || member(value)?.name === 'logger'
  }
  const isConsole = (value: ts.Expression): boolean => ts.isIdentifier(unwrap(value)) && unwrap(value).getText(source) === 'console'
  const loggingMethod = (value: ts.Expression): boolean => {
    const access = member(value)
    return !!access && ((isLogger(access.receiver) && (access.name === undefined || levels.has(access.name))) ||
      (isConsole(access.receiver) && (access.name === undefined || consoleLevels.has(access.name))))
  }
  const safeCall = (value: ts.Expression): boolean => {
    value = unwrap(value)
    return ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === 'safeError' && value.arguments.length === 1
  }
  const allowedParameter = (value: ts.Identifier): boolean => {
    const symbol = ts.isShorthandPropertyAssignment(value.parent) ? checker.getShorthandAssignmentValueSymbol(value.parent) : checker.getSymbolAtLocation(value)
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
      }
    }
  }
  const walk = (node: ts.Node) => {
    if (ts.isCallExpression(node) && loggingMethod(node.expression)) node.arguments.forEach(checkArgument)
    if (ts.isVariableDeclaration(node) && node.initializer && isLogger(node.initializer)) report(node, 'logger-alias')
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && isLogger(node.right)) report(node, 'logger-alias')
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
    'insertEvents(exec, rows, message => payload.logger.error(message))',
  ])('rejects unsafe snippet: %s', text => expect(scan(text, 'src/example.ts').length).toBeGreaterThan(0))

  test.each([
    'payload.logger.error({ err: safeError(error), experimentId }, "Failure")',
    'req.payload.logger.warn({ err: safeError(error), snapshotId, metricId, flagPoint, slug, collection, id, phase, operation }, "Failure")',
    'const { logger } = payload; logger.error({ err: safeError(error) }, "Failure")',
    'console.error("Failure", safeError(error))', 'console.warn("Fixed warning")', 'logger?.debug("Fixed debug")',
    'logger.error({ msg: "Fixed", err: safeError(error) })', 'logger.error({ ["err"]: safeError(error) })',
    '(payload.logger.error as Function)({ err: safeError(error) }, "Failure")',
  ])('accepts safe snippet: %s', text => expect(scan(text, 'src/example.ts')).toEqual([]))

  test('reviewed string parameters are tied to the right declaration and file', () => {
    const text = 'insertEvents(exec, rows, message => payload.logger.error(message))'
    expect(scan(text, 'src/server/recordExposures.ts')).toEqual([])
    expect(scan('other(exec, rows, message => payload.logger.error(message))', 'src/server/recordExposures.ts').length).toBeGreaterThan(0)
    expect(scan('insertEvents(exec, rows, message => { function f(message) { payload.logger.error(message) } })', 'src/server/recordExposures.ts').length).toBeGreaterThan(0)
    expect(scan('function neverThrow(name: string) { console.error(`hook ${name}`, safeError(error)) }', 'src/hooks/hostHook.ts')).toEqual([])
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
