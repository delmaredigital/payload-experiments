// xp-areas: power
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const PIN = '0553a68def700abbcaaca8f5096da913f197804c'
const SHA256 = 'f8a8846a2758f25a496000c3e09faa230b78b25f7624d36b3ebcb7491533ec4f'
const module = 'packages/shared/src/power/power.ts'
const root = fileURLToPath(new URL('../../', import.meta.url))
const symbols = ['powerEstFrequentist', 'powerFrequentist', 'findMdeFrequentist', 'powerEstBayesian', 'findMdeBayesian', 'powerMetricWeeks']
let out = resolve(root, 'packages/stats/fixtures')
let ref = PIN
let only
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i]
  if (!['--out', '--ref', '--only'].includes(flag) || !process.argv[i + 1]) throw new Error(`Invalid argument: ${flag}`)
  const value = process.argv[++i]
  if (flag === '--out') out = resolve(value)
  if (flag === '--ref') ref = value
  if (flag === '--only') only = value.split(',')
}
if (only && !only.includes('power')) process.exit(0)
if (!/^[a-f0-9]{40}$/i.test(ref)) throw new Error('--ref requires a 40-character commit SHA')
ref = ref.toLowerCase()

async function get(path) {
  const response = await fetch(`https://raw.githubusercontent.com/growthbook/growthbook/${ref}/${path}`, { redirect: 'error' })
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}
const [bytes, constants] = await Promise.all([get(module), get('packages/shared/src/constants.ts')])
const digest = createHash('sha256').update(bytes).digest('hex')
if (ref === PIN && digest !== SHA256) throw new Error(`SHA256 mismatch for ${module}: ${digest}`)
const constant = constants.toString('utf8').match(/^export\s+const\s+DEFAULT_PROPER_PRIOR_STDDEV\s*=\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*;/m)
if (!constant) throw new Error('DEFAULT_PROPER_PRIOR_STDDEV numeric declaration not found')
const priorStddev = Number(constant[1])
if (!Number.isFinite(priorStddev) || (ref === PIN && priorStddev !== 0.3)) throw new Error('Unexpected DEFAULT_PROPER_PRIOR_STDDEV')

// Independent implementation of the brief's frozen TS input mapping; never
// import packages/stats/src. Our mapping's absent-prior default stays 0.3 in
// drift mode too; the shim reflects upstream's fetched constant separately.
function toUpstreamMetric(name, m) {
  const common = {
    name,
    effectSize: m.effectSize,
    overrideMetricLevelSettings: false,
    overridePriorLiftMean: 0,
    overridePriorLiftStandardDeviation: 0,
    overrideProper: false,
    metricPriorLiftMean: m.prior?.mean ?? 0,
    metricPriorLiftStandardDeviation: m.prior ? Math.sqrt(m.prior.variance) : 0.3,
    metricProper: m.prior?.proper ?? false,
  }
  return m.type === 'mean'
    ? { ...common, type: m.type, mean: m.mean, standardDeviation: m.standardDeviation }
    : { ...common, type: m.type, conversionRate: m.conversionRate }
}
function upstreamArgs(symbol, args) {
  if (symbol === 'powerFrequentist') return args
  if (symbol !== 'powerMetricWeeks') return [toUpstreamMetric('', args[0]), ...args.slice(1)]
  const input = args[0]
  return [{
    metrics: Object.fromEntries(Object.entries(input.metrics).map(([name, m]) => [name, toUpstreamMetric(name, m)])),
    nVariations: input.nVariations,
    nWeeks: input.nWeeks,
    alpha: input.alpha,
    usersPerWeek: input.usersPerWeek,
    targetPower: input.targetPower,
    statsEngineSettings: input.method.type === 'frequentist' ? input.method : { type: 'bayesian', sequentialTesting: false },
    metricValuesData: { source: 'manual' }, // UI provenance; ignored by upstream.
  }]
}
function project(symbol, result) {
  if (symbol !== 'powerMetricWeeks') return result
  // The public PowerWeeksResult drops upstream's extra success discriminant.
  const { type, ...projected } = result
  if (type !== 'success') throw new Error(`Unexpected weekly result type: ${type}`)
  return projected
}
function sorted(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) return { $num: Number.isNaN(value) ? 'nan' : value > 0 ? 'inf' : '-inf' }
  if (Array.isArray(value)) return value.map(sorted)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]))
  return value
}
const inputs = JSON.parse(await readFile(new URL('./power_cases.json', import.meta.url), 'utf8'))
if (Object.keys(inputs).sort().join(',') !== [...symbols].sort().join(',')) throw new Error('power_cases.json must cover exactly the six public symbols')
const temporary = await mkdtemp(join(tmpdir(), 'xp-power-'))
const run = promisify(execFile)
try {
  await run('npm', ['install', '--prefix', temporary, '--no-save', '--ignore-scripts', '@stdlib/stats@0.1.1'], { maxBuffer: 32 * 1024 * 1024 })
  const { stdout } = await run('npm', ['ls', '--prefix', temporary, '--all', '--json'], { maxBuffer: 32 * 1024 * 1024 })
  const resolvedPins = new Set()
  function collectPins(tree) {
    for (const [name, dependency] of Object.entries(tree.dependencies ?? {})) {
      if (name.startsWith('@stdlib/')) {
        if (typeof dependency.version !== 'string') throw new Error(`Missing installed version: ${name}`)
        resolvedPins.add(`${name}@${dependency.version}`)
      }
      collectPins(dependency)
    }
  }
  collectPins(JSON.parse(stdout))
  if (!resolvedPins.has('@stdlib/stats@0.1.1')) throw new Error('Installed @stdlib/stats pin not found')
  const stdlib = [...resolvedPins].sort()
  const requireTemporary = createRequire(join(temporary, 'package.json'))
  const normalPath = requireTemporary.resolve('@stdlib/stats/base/dists/normal')
  const shimPath = join(temporary, 'constants.mjs')
  await writeFile(shimPath, `export const DEFAULT_PROPER_PRIOR_STDDEV = ${priorStddev};\n`)
  let source = bytes.toString('utf8')
    .replace(/^import\s+(?:type\s+)?\{[^}]*\}\s+from\s+["']shared\/types\/[^"']+["'];?\r?\n/gm, '')
  function rewriteImport(specifier, path) {
    const quoted = [`"${specifier}"`, `'${specifier}'`]
    const matches = quoted.flatMap(q => [...source.matchAll(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))])
    if (matches.length !== 1) throw new Error(`Expected exactly one import of ${specifier}`)
    source = source.replace(matches[0][0], JSON.stringify(pathToFileURL(path).href))
  }
  rewriteImport('@stdlib/stats/base/dists/normal', normalPath)
  rewriteImport('../constants', shimPath)
  const { transformSync } = createRequire(join(root, 'package.json'))('@swc/core')
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'es6' },
  })
  const upstreamPath = join(temporary, 'upstream.mjs')
  await writeFile(upstreamPath, code)
  const upstream = await import(pathToFileURL(upstreamPath).href)
  // Evaluate everything before touching the destination, so a failing upstream
  // call or malformed case cannot leave a partially regenerated fixture set.
  const outputs = symbols.map(symbol => {
    if (!Array.isArray(inputs[symbol]) || !inputs[symbol].length) throw new Error(`No cases: ${symbol}`)
    const names = new Set()
    const cases = inputs[symbol].map(({ name, args }) => {
      if (typeof name !== 'string' || names.has(name) || !Array.isArray(args)) throw new Error(`Invalid/duplicate case: ${symbol}/${name}`)
      names.add(name)
      const expected = project(symbol, upstream[symbol](...upstreamArgs(symbol, args)))
      return { name, input: { args }, expected }
    })
    const fixture = { source: { repo: 'growthbook/growthbook', sha: ref, module, symbol, pins: { stdlib } }, cases }
    return { name: `power.${symbol}.json`, json: JSON.stringify(sorted(fixture), null, 2) + '\n', count: cases.length }
  })
  await mkdir(out, { recursive: true })
  for (const { name, json, count } of outputs) {
    await writeFile(join(out, name), json)
    console.log(`${name}: ${count} cases`)
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
