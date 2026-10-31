import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PIN = '0553a68def700abbcaaca8f5096da913f197804c'
const SHA256 = 'b394de221db130f3802c1015166598acffb487dfa15c4ecf79872bc58d4800c0'
const root = fileURLToPath(new URL('../../', import.meta.url))
const { parseSync, transformSync } = createRequire(join(root, 'package.json'))('@swc/core')
let out = resolve(root, 'packages/stats/fixtures')
let ref = PIN
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i]
  if (!['--out', '--ref', '--only'].includes(flag) || !process.argv[i + 1]) throw new Error(`Invalid argument: ${flag}`)
  const value = process.argv[++i]
  if (flag === '--out') out = resolve(value)
  if (flag === '--ref') ref = value
}
if (!/^[a-f0-9]{40}$/i.test(ref)) throw new Error('--ref requires a 40-character commit SHA')
ref = ref.toLowerCase()
const module = 'packages/sdk-js/src/util.ts'
const response = await fetch(`https://raw.githubusercontent.com/growthbook/growthbook/${ref}/${module}`, { redirect: 'error' })
if (!response.ok) throw new Error(`GET ${module}: ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
const digest = createHash('sha256').update(bytes).digest('hex')
if (ref === PIN && digest !== SHA256) throw new Error(`SHA256 mismatch for ${module}: ${digest}`)
console.log(`${module}: ${ref === PIN ? 'sha256 OK' : 'drift (sha256 not enforced)'}`)

// Select upstream declarations without rewriting their bodies or importing any
// local port. The rest of util.ts imports unrelated SDK runtime dependencies.
const wanted = new Set(['hashFnv32a', 'hash', 'getEqualWeights', 'getBucketRanges', 'chooseVariation', 'inRange'])
const ast = parseSync(bytes.toString('utf8'), { syntax: 'typescript' })
const declarations = []
for (const node of ast.body) {
  const declaration = node.type === 'ExportDeclaration' ? node.declaration : node
  if (declaration.type === 'FunctionDeclaration' && wanted.delete(declaration.identifier.value)) {
    declarations.push(bytes.subarray(node.span.start - ast.span.start, node.span.end - ast.span.start).toString('utf8'))
  }
}
if (wanted.size) throw new Error(`Missing upstream functions: ${[...wanted].join(', ')}`)
const { code } = transformSync(declarations.join('\n'), {
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'es6' },
})
const temporary = await mkdtemp(join(tmpdir(), 'xp-sdk-'))
let sdk
try {
  const path = join(temporary, 'upstream.mjs')
  await writeFile(path, `const process = { env: { NODE_ENV: 'production' } };\nconst console = { error() {} };\n${code}`)
  sdk = await import(pathToFileURL(path).href)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
const { hash, getBucketRanges, chooseVariation, inRange } = sdk

// These formulas come from the STATS-L1 brief (§6.1, §5.3, §7.6/§8.1.5),
// independently of packages/stats/src/assignment/*.ts.
function armWeightsToFractions(w) {
  if (!w.every(x => Number.isInteger(x) && x >= 0) || w.reduce((sum, x) => sum + x, 0) !== 100) throw new RangeError('weights')
  return w.map(x => x / 100)
}
function assignArm({ seed, unitId, weights, coverage }) {
  if (!seed.endsWith('|')) throw new RangeError('seed')
  return chooseVariation(hash(seed, unitId, 2), getBucketRanges(weights.length, coverage, armWeightsToFractions(weights)))
}
function layerSlice(layerSlug, unitId) {
  return Math.floor(hash(layerSlug + '|', unitId, 2) * 100)
}
function rolloutBucketRanges(testWeights, coverage) {
  const fractions = armWeightsToFractions(testWeights)
  const n = testWeights.length
  if (n < 2 || testWeights[n - 1] === 0) throw new RangeError('holdout')
  const ranges = getBucketRanges(n, coverage, fractions)
  const holdout = ranges[n - 1]
  const winner = [0, coverage * holdout[0]]
  return { winner, holdout }
}
const fixtures = []
function fixture(name, symbol, cases) {
  fixtures.push({ name, source: { repo: 'growthbook/growthbook', sha: ref, module, symbol }, cases })
}
function entry(name, fn, args, raises = false) {
  let expected
  try {
    expected = fn(...args)
  } catch (error) {
    if (!raises || !(error instanceof RangeError)) throw error
    expected = { $raises: 'RangeError' }
  }
  if (raises && expected?.$raises !== 'RangeError') throw new Error(`Expected RangeError: ${name}`)
  return { name, input: { args }, expected }
}
const rangeCases = []
for (let i = 0; i < 20; i++) {
  const start = i / 25
  const end = start + (i % 4) / 20
  for (const [j, point] of [start - 1e-12, start, start + 1e-12, (start + end) / 2, end - 1e-12, end, end + 1e-12, -1, 0, 1].entries()) {
    rangeCases.push(entry(`range-${i}-point-${j}`, inRange, [point, [start, end]]))
  }
}
fixture('sdk.inRange', 'inRange', rangeCases)
const weightSets = [[50, 50], [45, 45, 10], [34, 33, 33], [5, 93, 2], [25, 25, 25, 15, 10]]
const coverages = [0.3, 0.5, 1]
const assignCases = []
for (let i = 0; i < 5000; i++) {
  const weights = weightSets[i % weightSets.length]
  const coverage = coverages[Math.floor(i / weightSets.length) % coverages.length]
  const seed = ['exp-a|', 'exp-b|'][Math.floor(i / (weightSets.length * coverages.length)) % 2]
  assignCases.push(entry(`u${i}`, assignArm, [{ seed, unitId: `u${i}`, weights, coverage }]))
}
for (const [i, args] of [
  { seed: 'exp-a', unitId: 'u0', weights: [50, 50], coverage: 1 },
  ...[[49, 50], [49.5, 50.5], [-1, 101]].map(weights => ({ seed: 'exp-a|', unitId: 'u0', weights, coverage: 1 })),
].entries()) assignCases.push(entry(`invalid-${i}`, assignArm, [args], true))
fixture('assignment.assignArm', 'composed:§6.1', assignCases)
const sliceCases = []
for (const slug of ['layer-a', 'layer-b']) {
  for (let i = 0; i < 1000; i++) sliceCases.push(entry(`${slug}-u${i}`, layerSlice, [slug, `u${i}`]))
}
for (let i = 0; i < 50; i++) {
  sliceCases.push(entry(`unicode-${i}`, layerSlice, [['layer-a', 'layer-b'][i % 2], `用户-é-🧪-${i}`]))
}
fixture('assignment.layerSlice', 'composed:§5.3', sliceCases)
const rolloutCases = []
for (const h of [2, 5, 10, 25, 50]) {
  for (let a = 0; a <= 100 - h; a += 7) {
    for (const c of coverages) rolloutCases.push(entry(`a${a}-h${h}-c${c}`, rolloutBucketRanges, [[a, 100 - a - h, h], c]))
  }
}
for (const c of coverages) rolloutCases.push(entry(`explicit-5-93-2-c${c}`, rolloutBucketRanges, [[5, 93, 2], c]))
for (const [i, weights] of [[100], [50, 50, 0], [60, 30], [49.5, 48.5, 2], [-1, 99, 2], []].entries()) {
  rolloutCases.push(entry(`invalid-${i}`, rolloutBucketRanges, [weights, 1], true))
}
fixture('assignment.rolloutBucketRanges', 'composed:§7.6/§8.1.5', rolloutCases)
const fractionCases = [...weightSets, [100], [0, 100], [0, 0, 100]].map((weights, i) => entry(`valid-${i}`, armWeightsToFractions, [weights]))
for (const [i, weights] of [[], [49, 50], [49.5, 50.5], [-1, 101]].entries()) {
  fractionCases.push(entry(`invalid-${i}`, armWeightsToFractions, [weights], true))
}
fixture('assignment.armWeightsToFractions', 'composed:§6.1', fractionCases)
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]))
  return value
}
const outputs = fixtures.map(({ name, ...data }) => {
  if (!data.cases.length || new Set(data.cases.map(c => c.name)).size !== data.cases.length) throw new Error(`Invalid cases for ${name}`)
  return [`${name}.json`, JSON.stringify(sorted(data), null, 2) + '\n', data.cases.length]
})
await mkdir(out, { recursive: true })
for (const [name, json, count] of outputs) {
  await writeFile(resolve(out, name), json)
  console.log(`${name}: ${count} cases`)
}
