import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, test } from 'vitest'
import { ADVANCED_COPY } from '../../src/admin/copy/advanced.js'
import { metricsCollection } from '../../src/collections/metrics.js'
import { layersCollection } from '../../src/collections/layers.js'
import { sampleOptions } from '../collections/fixtures.js'

const src = fileURLToPath(new URL('../../src/', import.meta.url))
const forbidden = /\b(?:arms?|phases?|flag ?points?|unit ?types?|unitType|CUPED|exposure ?polic(?:y|ies)|percentiles?)\b|\bin (?:Metrics|Who|Groups|Review)\b|\b(?:Metrics|Who|Review) tab\b/i
const hits = (strings: string[]) => strings.filter(value => forbidden.test(value))
const samples: Record<string, unknown[][]> = {
  chartSummary: [['Example', 'Example', 'Example', 'Example', []], ['Example', 'Example', 'Example', 'Example', ['Example']]],
  suggestedWeeks: [[3]], weeksHint: [[28]], layerSummary: [[30, 70]], layerRow: [['Example', 'Example', 30]],
  issueMessage: [[{ code: 'weights-total', message: 'Example' }, 50], [{ code: 'future', message: 'Example' }, 100]],
  refusalMessage: [[undefined, 400], ['not-found', 404], ['forbidden', 403], ['unauthenticated', 401], ['commit-unverified', 409], ['not-implemented', 501]],
  decideCopy: [['Example', false, false], ['Example', true, false], ['Example', false, true]],
  makeContentCopy: [['Example', 'flag'], ['Example', 'block'], ['Example', 'page']],
  runningCopy: [['Example', 100, 10], [null, null, null]],
}
function strings(value: unknown, name = '', skipAdvanced = false): string[] {
  // Identity, not filename or export-name matching: no other object is exempt.
  if (skipAdvanced && value === ADVANCED_COPY) return []
  if (typeof value === 'string') return [value]
  if (typeof value === 'function') {
    const cases = samples[name] ?? [Array(8).fill('Example')]
    return cases.flatMap(args => strings(value(...args)))
  }
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => strings(item, key, skipAdvanced))
  return []
}
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
/** Parse JSX text and literal text expressions/visible attributes, never source regex. */
function jsxStrings(source: string): string[] {
  const file = ts.createSourceFile('copy.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const result: string[] = []
  function text(node: ts.Node) {
    if (ts.isStringLiteralLike(node)) result.push(node.text)
    else if (ts.isConditionalExpression(node)) { text(node.whenTrue); text(node.whenFalse) }
    else if (ts.isBinaryExpression(node)) { text(node.left); text(node.right) }
    else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) text(node.expression)
    else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(text)
    else if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) text(node.expression.expression)
      node.arguments.forEach(text)
    } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) text(node.body)
    else if (ts.isBlock(node)) {
      for (const statement of node.statements) if (ts.isReturnStatement(statement) && statement.expression) text(statement.expression)
    }
    else if (ts.isTemplateExpression(node)) {
      result.push(node.head.text, ...node.templateSpans.map(span => span.literal.text))
    }
  }
  function walk(node: ts.Node) {
    if (ts.isJsxText(node)) result.push(node.text.trim())
    else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) text(node.expression)
    else if (ts.isJsxAttribute(node) && ['label', 'title', 'placeholder', 'aria-label', 'description', 'alt'].includes(node.name.getText(file)) && node.initializer) {
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) text(node.initializer.expression)
      else text(node.initializer)
    }
    ts.forEachChild(node, walk)
  }
  walk(file)
  return result
}
function collectionStrings(config: unknown): string[] {
  if (!config || typeof config !== 'object') return []
  if (Array.isArray(config)) return config.flatMap(collectionStrings)
  return Object.entries(config).flatMap(([key, value]) =>
    ['label', 'labels', 'description'].includes(key) ? strings(value)
      : ['fields', 'tabs', 'options', 'admin'].includes(key) ? collectionStrings(value) : [])
}

test('exported editor copy and all copy functions use surface vocabulary', async () => {
  const paths = [...files(join(src, 'admin/copy')).filter(file => file.endsWith('.ts')),
    join(src, 'puck/copy.ts'), join(src, 'puck/editor/copy.ts')]
  for (const path of paths) {
    const module = await import(/* @vite-ignore */ path)
    expect(hits(strings(module, '', true)), path).toEqual([])
  }
})
test('admin JSX text uses surface vocabulary', () => {
  for (const path of files(join(src, 'admin')).filter(file => file.endsWith('.tsx'))) {
    expect(hits(jsxStrings(readFileSync(path, 'utf8'))), path).toEqual([])
  }
})
test('goal and test-group collection labels, descriptions and option labels use surface vocabulary', () => {
  for (const config of [metricsCollection(sampleOptions()), layersCollection(sampleOptions())]) {
    const copy = collectionStrings(config)
    expect(copy.length).toBeGreaterThan(10)
    expect(hits(copy), config.slug).toEqual([])
  }
})
test.each(['Arm', 'phases', 'in Metrics', 'Who tab'])('audit reports planted copy fixture: %s', value => {
  expect(hits(strings({ nested: { message: value }, sentence: () => value }))).toEqual([value, value])
  expect(hits(jsxStrings(`<p>${value}</p><p>{'${value}'}</p><input title="${value}" />`))).toEqual([value, value, value])
})
test.each([
  "<p>{String('phases')}</p>",
  "<p>{['Arm'].join(' ')}</p>",
  "<p>{['Example'].map(() => 'in Metrics')}</p>",
  "<p>{['phases'].map(word => <span>{word}</span>)}</p>",
])('JSX scanner follows nested text expressions: %s', source => {
  expect(hits(jsxStrings(source))).toHaveLength(1)
})
test('implementation strings outside JSX are not copy', () => {
  expect(hits(jsxStrings("const fields = ['unitType']; <p>{fields.map(key => <span>{labels[key]}</span>)}</p>"))).toEqual([])
})
test('Advanced is the sole exception, by object identity', () => {
  expect(hits(strings({ ADVANCED_COPY }, '', true))).toEqual([])
  expect(hits(strings({ ADVANCED_COPY: { ...ADVANCED_COPY } }, '', true))).not.toEqual([])
  expect(hits(strings(ADVANCED_COPY))).toContain('CUPED')
})
