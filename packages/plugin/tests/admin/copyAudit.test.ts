import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, test } from 'vitest'
import { OUTSIDE_GOAL } from '../../src/goals/fairness.js'
import { SAVE_PAGE, PUBLISH_PAGE } from '../../src/testSurface/surface/editorPlacement.js'
import { ADVANCED_COPY } from '../../src/testSurface/copy/advanced.js'
import { PAGE_COPY } from '../../src/testSurface/copy/pages.js'
import { metricsCollection } from '../../src/collections/metrics.js'
import { layersCollection } from '../../src/collections/layers.js'
import { sampleOptions } from '../collections/fixtures.js'
import { copyPaths, editorFiles, helperPaths, helperStrings } from './copySources.js'

const forbidden = /\b(?:arms?|phases?|flag ?points?|unit ?types?|unitType|CUPED|exposure ?polic(?:y|ies)|percentiles?)\b|\bin (?:Metrics|Who(?! takes part\b)|Groups|Review)\b|\b(?:Metrics|Who|Review) tab\b/i
const hits = (strings: string[]) => strings.filter(value => forbidden.test(value))
test('the neutral click-goal picker copy participates in the shared copy audit', () => {
  expect(copyPaths).toContain(new URL('../../src/goals/picker/copy.ts', import.meta.url).pathname)
})
const samples: Record<string, unknown[][]> = {
  moreBlockers: [[1], [3]], outsideTest: [['Variant A']],
  removeHelp: [[0], [1], [3]],
  pageInUseCopy: [['/example'], ['/example', true]],
  unpublishedPageCopy: [['/example'], ['/example', { original: true, found: true, collection: 'Pages' }], ['/example', { original: false, found: true, collection: 'Pages' }], ['/example', { original: false, found: false, collection: 'Pages' }]],
  sameAddressCopy: [['Variant A', 'Original', '/example'], ['Variant A', 'Original', '/example', 'Pages']],
  usedPageCopy: [['Original']], usedAddressCopy: [['Original', '/example', 'Pages']],
  pageNotFoundCopy: [['/example', 'Pages']], pageFieldCopy: [['Variant A']],
  openOriginalCopy: [['Pages']], openCollectionCopy: [['Pages']], pageStepCopy: [['Variant A']],
  blockPosition: [['Hero', 2]], blockTestName: [['About us', 'Hero']],
  blockDraftStatus: [['Hero']], blockFinishedStatus: [['Shorter form']],
  blockDecidedStatus: [['Shorter form', false], ['Shorter form', true]],
  blockSaveNotice: [[false], [true]], blockSyncNotice: [[false], [true]],
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
/** Parse JSX text and literal text expressions/visible attributes, never source regex. */
// `path` is also implementation metadata: Payload field paths such as analysis.cuped.
const implementationAttributes = new Set(['className', 'id', 'htmlFor', 'key', 'href', 'type', 'name', 'role', 'rel', 'target', 'method', 'style', 'path'])
function jsxStrings(source: string): string[] {
  const file = ts.createSourceFile('copy.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const result: string[] = []
  function text(node: ts.Node) {
    if (ts.isStringLiteralLike(node)) result.push(node.text)
    else if (ts.isConditionalExpression(node)) { text(node.whenTrue); text(node.whenFalse) }
    else if (ts.isBinaryExpression(node) && ![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) { text(node.left); text(node.right) }
    else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) text(node.expression)
    else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(text)
    else if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) text(node.expression.expression)
      // reasonFor's second argument is a computed document field path.
      const args = ts.isIdentifier(node.expression) && node.expression.text === 'reasonFor' ? node.arguments.slice(0, 1) : node.arguments
      args.forEach(text)
    } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) text(node.body)
    else if (ts.isBlock(node)) {
      function returns(child: ts.Node) {
        if (ts.isReturnStatement(child) && child.expression) text(child.expression)
        else ts.forEachChild(child, returns)
      }
      node.statements.forEach(returns)
    }
    else if (ts.isTemplateExpression(node)) {
      result.push(node.head.text)
      for (const span of node.templateSpans) { text(span.expression); result.push(span.literal.text) }
    }
  }
  function walk(node: ts.Node) {
    if (ts.isJsxText(node)) result.push(node.text.trim())
    else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) text(node.expression)
    else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(file)
      const optionKey = name === 'value' && node.parent.parent.tagName.getText(file) === 'option'
      if (implementationAttributes.has(name) || /^on[A-Z]/.test(name) || name.startsWith('data-') || optionKey) return
      if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        text(node.initializer.expression)
      }
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
  for (const path of copyPaths) {
    const module = await import(/* @vite-ignore */ path)
    expect(hits(strings(module, '', true)), path).toEqual([])
  }
})
test('the unchosen-page placeholder participates in the copy audit', () => {
  expect(strings(PAGE_COPY)).toContain('Choose a page')
  expect(hits(strings(PAGE_COPY))).toEqual([])
})
test('admin and Puck JSX text uses surface vocabulary', () => {
  expect(editorFiles.filter(file => file.endsWith('.tsx')).flatMap(path =>
    hits(jsxStrings(readFileSync(path, 'utf8'))).map(value => ({ path, value })))).toEqual([])
})
test('all admin and Puck helper copy uses surface vocabulary', () => {
  expect(helperPaths.flatMap(path =>
    hits(helperStrings(readFileSync(path, 'utf8'), path)).map(value => ({ path, value })))).toEqual([])
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
  expect(hits(jsxStrings('<Widget path={`${path}.arm`} required={fields.some(field => field.name === "arm")} reason={reasonFor(test, "exposurePolicy")} />'))).toEqual([])
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
  expect(hits(helperStrings("function label() { return 'Choose an arm' }; const hint = () => `Over the last phase: ${value}`; const branch = x => x ? 'in Metrics' : 'Who tab'")))
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

test.each([
  ["<Widget hint={x ? 'Choose an arm' : 'Pick'} />", 'Choose an arm'],
  ['<Widget body={`Over the ${word} phase`} />', ' phase'],
  ["<Widget notice={cond && 'in Metrics'} />", 'in Metrics'],
  ["<Widget notice={cond || 'Choose an arm'} />", 'Choose an arm'],
  ["<Widget hint={['Choose an arm']} />", 'Choose an arm'],
  ["<Widget hint={String('Choose an arm')} />", 'Choose an arm'],
  ["<Widget hint={() => 'Choose an arm'} />", 'Choose an arm'],
  ["<Widget hint={() => { return 'Choose an arm' }} />", 'Choose an arm'],
  ["<Widget hint={() => { if (ready) return 'Choose an arm'; return 'Pick' }} />", 'Choose an arm'],
])('custom props follow computed text: %s', (source, expected) => {
  expect(hits(jsxStrings(source))).toEqual([expected])
})
test.each(['onClick', 'onChange', 'onSubmit', 'onCustomAction'])('event handler %s is implementation', name => {
  expect(hits(jsxStrings(`<Widget ${name}={() => send('Choose an arm')} />`))).toEqual([])
})
test.each([
  ["export function label() { return 'Choose an arm' }", 'Choose an arm'],
  ["export const label = () => 'Choose an arm'", 'Choose an arm'],
  ["export function fail() { throw new Error('Choose an arm') }", 'Choose an arm'],
  ["export function label(note: string = 'Pick an arm first') { return note }", 'Pick an arm first'],
  ["export const label = (note: string = 'Pick an arm first') => note", 'Pick an arm first'],
  ["export function label(path = 'Pick an arm first') { return path }", 'Pick an arm first'],
  ["export const PLANTED = ['Each arm gets equal traffic.', 'Choose a version.']", 'Each arm gets equal traffic.'],
  ["const CODE_MESSAGES: Record<string, string> = { noArm: 'Add an arm first' }; export const label = c => CODE_MESSAGES[c]", 'Add an arm first'],
  ["const GROUPS = { a: 'Arm', b: 'arms' }; export const label = k => GROUPS[k]", 'Arm'],
  ["export const HEADERS = ['Phase', 'phase-id']", 'Phase'],
  ["function fail() { throw new TypeError('Choose an arm') }", 'Choose an arm'],
  ["function fail(reject) { reject(new Error('Choose an arm')) }", 'Choose an arm'],
  ...['message', 'label', 'title', 'headline', 'detail', 'hint'].map(key => [`const copy = { ${key}: 'Choose an arm' }`, 'Choose an arm']),
])('helper scanner reports authored text: %s', (source, expected) => {
  expect(hits(helperStrings(source))).toEqual([expected])
})
test.each([
  "import { arm } from './phase.js'; export const result = () => arm",
  "export const check = value => value === 'arm'",
  "export const check = value => value !== 'phase'",
  "export const load = () => fetch(`/phase/${id}/arm`, { method: 'GET' })",
  "export const load = () => window.fetch('/phase/arm')",
  "async function request(path: () => string) { return fetch(path()) }; export const load = () => request(() => `/phase/${id}/arm`)",
  "function query() { const params = new URLSearchParams(); return params.set('phase', round) }",
  "function query() { const params = new URLSearchParams(); return params.append('arm', version) }",
  "export const data = () => ({ 'arm': 'Original', ['phase']: 'Round' })",
  "function groups(path = 'arms') { return fields[path] }",
  "const fields = ['arms', 'phase']; const paths = { client: '/payload-experiments/admin' }",
  "const checks = [value === 'Choose an arm', value !== 'Over the last phase']",
  "const data = { 'Choose an arm': 'Original', ['Over the last phase']: 'Round' }",
  "const loads = [fetch('/Choose an arm'), window.fetch('/Over the last phase')]",
  "function request(path) { return fetch(path) }; const loads = [request('/Choose an arm')]",
  "const params = new URLSearchParams(); const query = [params.set('Choose an arm', version), params.append('Over the last phase', round)]",
  ...['className', 'classNames', 'clsx', 'cn', 'cx'].map(name => `const css = [${name}('Choose an arm', { phase: active })]`),
  ...['className', 'classNames', 'clsx', 'cn', 'cx'].map(name => `export const css = () => ${name}('arm', { phase: active })`),
])('helper scanner excludes implementation syntax: %s', source => {
  expect(hits(helperStrings(source))).toEqual([])
})
test('fetch options can still contain authored messages', () => {
  expect(hits(helperStrings("const load = () => fetch('/phase', { message: 'Choose an arm' })"))).toEqual(['Choose an arm'])
})

test('page combobox copy retains only used keys and names unresolved pages', async () => {
  const { pageNotFoundCopy, pageFieldCopy } = await import('../../src/testSurface/copy/pages.js')
  expect(pageNotFoundCopy('/example', 'Pages')).toBe("/example isn't in Pages. Choose a page.")
  expect(pageFieldCopy('Variant A')).toBe('Page for Variant A')
  for (const removed of ['search', 'change', 'close', 'noPage']) expect(PAGE_COPY).not.toHaveProperty(removed)
})


test('editor placement instructions and named goal warnings use editor language', () => {
  expect(hits([SAVE_PAGE, PUBLISH_PAGE, OUTSIDE_GOAL('Sign up'), OUTSIDE_GOAL('Sign up', 'page')])).toEqual([])
  expect(OUTSIDE_GOAL('Sign up')).toContain('click goal “Sign up”')
  expect(OUTSIDE_GOAL('Sign up')).toContain('The test can still start.')
})
