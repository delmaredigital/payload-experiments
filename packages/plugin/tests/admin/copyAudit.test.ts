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
const forbidden = /\b(?:arms?|phases?|flag ?points?|unit ?types?|unitType|CUPED|exposure ?polic(?:y|ies)|percentiles?)\b|\bin (?:Metrics|Who(?! takes part\b)|Groups|Review)\b|\b(?:Metrics|Who|Review) tab\b/i
const hits = (strings: string[]) => strings.filter(value => forbidden.test(value))
const samples: Record<string, unknown[][]> = {
  pageGuardCopy: [['Example', 'running'], ['Example', 'decided'], ['Example', 'archived'], ['Example', 'archived', 'original']],
  versionPageUnavailableCopy: [['/example', 'running'], ['/example', 'decided']], versionPageUncheckedCopy: [['/example', 'running'], ['/example', 'decided']],
  groupShare: [['50', 'Original'], ['50', 'Shorter form']],
  moreDays: [['1'], ['2']], staleExperiment: [[undefined], ['Earlier test']],
  placementNext: [['Example', ''], ['Example', 'Example']],
  stoppedCopy: [[null], ['2 Nov 2026']], decidedCopy: [[null, 'Example'], ['2 Nov 2026', 'Example']],
  chartSummary: [['Example', 'Example', 'Example', 'Example', []], ['Example', 'Example', 'Example', 'Example', ['Example']]],
  suggestedWeeks: [[3]], weeksHint: [[28]], layerSummary: [[30, 70]], layerRow: [['Example', 'Example', 30]],
  issueMessage: [[{ code: 'weights-total', message: 'Example' }, 50], [{ code: 'future', message: 'Example' }, 100]],
  refusalMessage: [[undefined, 400], [undefined, 400, 'Example'], ['not-found', 404], ['forbidden', 403], ['unauthenticated', 401], ['commit-unverified', 409], ['not-implemented', 501]],
  decideCopy: [['Example', false, false], ['Example', true, false], ['Example', false, true]],
  makeContentCopy: [['Example', 'flag'], ['Example', 'block'], ['Example', 'page']],
  metricUnavailable: ['source-failed', 'source-unavailable', 'unit-type-unavailable', 'non-finite-values', 'non-finite-covariates', 'budget', 'not-supplied', 'analysis-failed', 'secret-value'].map(reason => ['Example', reason]),
  contentReportCopy: ['locked', 'forbidden', 'not-found', 'validation', 'update-failed', 'secret-value'].flatMap(reason => [[reason, false], [reason, true]]),
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
// `path` is also implementation metadata: Payload field paths such as analysis.cuped.
const implementationAttributes = new Set(['className', 'id', 'htmlFor', 'key', 'href', 'type', 'name', 'role', 'rel', 'target', 'method', 'style', 'path'])
const textExpressionAttributes = new Set(['label', 'title', 'placeholder', 'aria-label', 'description', 'alt'])
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
    else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(file)
      const optionKey = name === 'value' && node.parent.parent.tagName.getText(file) === 'option'
      if (implementationAttributes.has(name) || name.startsWith('data-') || optionKey) return
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const expression = node.initializer.expression
        // Every literal-valued prop is copy. Also follow computed text on known
        // copy props, without treating callbacks or computed field paths as text.
        if (ts.isStringLiteralLike(expression) || textExpressionAttributes.has(name)) text(expression)
      }
      else text(node.initializer)
    }
    ts.forEachChild(node, walk)
  }
  walk(file)
  return result
}
/** Include returned literal prose in models, including concise arrows and template branches. */
function modelStrings(source: string): string[] {
  const file = ts.createSourceFile('copy.model.ts', source, ts.ScriptTarget.Latest, true)
  const result: string[] = []
  function literals(node: ts.Node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) result.push(node.text)
    ts.forEachChild(node, literals)
  }
  function walk(node: ts.Node) {
    if (ts.isReturnStatement(node) && node.expression) literals(node.expression)
    else if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) literals(node.body)
    else ts.forEachChild(node, walk)
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
    join(src, 'admin/labels.ts'), join(src, 'puck/copy.ts'), join(src, 'puck/editor/copy.ts')]
  for (const path of paths) {
    const module = await import(/* @vite-ignore */ path)
    expect(hits(strings(module, '', true)), path).toEqual([])
  }
})
test('admin and Puck JSX text uses surface vocabulary', () => {
  for (const path of [...files(join(src, 'admin')), ...files(join(src, 'puck'))].filter(file => file.endsWith('.tsx'))) {
    expect(hits(jsxStrings(readFileSync(path, 'utf8'))), path).toEqual([])
  }
})
test('model return strings use surface vocabulary', () => {
  for (const path of files(join(src, 'admin')).filter(file => file.endsWith('.model.ts'))) {
    expect(hits(modelStrings(readFileSync(path, 'utf8'))), path).toEqual([])
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
  expect(hits(jsxStrings('<Widget path={`${path}.arm`} required={fields.some(field => field.name === "arm")} />'))).toEqual([])
})
test('JSX nested inside a custom expression prop is still scanned', () => {
  expect(hits(jsxStrings('<Widget render={() => <span>Choose an arm</span>} />'))).toEqual(['Choose an arm'])
})
test('custom JSX copy attributes are scanned; only implementation attributes and option keys are excluded', () => {
  expect(hits(jsxStrings('<Widget hint="Choose an arm" body={"in Metrics"} aria-description="phases" />')))
    .toEqual(['Choose an arm', 'in Metrics', 'phases'])
  expect(hits(jsxStrings('<input value="Choose an arm" />'))).toEqual(['Choose an arm'])
  for (const name of [...implementationAttributes, 'data-field']) {
    expect(hits(jsxStrings(`<Widget ${name}="arm" />`)), name).toEqual([])
  }
  expect(hits(jsxStrings('<option value="arm">Original</option>'))).toEqual([])
})
test('model return scanner reports prose in functions, arrows and branches', () => {
  expect(hits(modelStrings("function label() { return 'Choose an arm' }; const hint = () => `Over the last phase: ${value}`; const branch = x => x ? 'in Metrics' : 'Who tab'")))
    .toEqual(['Choose an arm', 'Over the last phase: ', 'in Metrics', 'Who tab'])
})
test('branch samples exercise Original and variant copy', () => {
  const groupShare = (share: string, label: string) => label === 'Original' ? 'Choose an arm' : 'in Metrics'
  expect(hits(strings({ groupShare }))).toEqual(['Choose an arm', 'in Metrics'])
})
test('Advanced is the sole exception, by object identity', () => {
  expect(hits(strings({ ADVANCED_COPY }, '', true))).toEqual([])
  expect(hits(strings({ ADVANCED_COPY: { ...ADVANCED_COPY } }, '', true))).not.toEqual([])
  expect(hits(strings(ADVANCED_COPY))).toContain('CUPED')
})

test('readiness may name the Who takes part section', () => {
  expect(hits(strings({ message: 'Remove the page-path rule in Who takes part; page block tests run on their page.' }))).toEqual([])
  expect(hits(strings({ message: 'Fix this in Who' }))).toEqual(['Fix this in Who'])
})
