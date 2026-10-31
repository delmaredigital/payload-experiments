import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PIN = '0553a68def700abbcaaca8f5096da913f197804c'
const SHA256 = '01811b2c39ab6f80426376342fa8338f5447d6d1a9d14095dbc06fc3cc882bf3'
const root = fileURLToPath(new URL('../../', import.meta.url))
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

const module = 'packages/sdk-js/test/cases.json'
const response = await fetch(`https://raw.githubusercontent.com/growthbook/growthbook/${ref}/${module}`, { redirect: 'error' })
if (!response.ok) throw new Error(`GET ${module}: ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
const digest = createHash('sha256').update(bytes).digest('hex')
if (ref === PIN && digest !== SHA256) throw new Error(`SHA256 mismatch for ${module}: ${digest}`)
console.log(`${module}: ${ref === PIN ? 'sha256 OK' : 'drift (sha256 not enforced)'}`)
const data = JSON.parse(bytes.toString('utf8'))
const entry = (name, args, expected) => ({ name, input: { args }, expected })
const fixtures = {
  hash: data.hash.map(([seed, value, version, expected], i) => entry(`hash-${i}`, [seed, value, version], expected)),
  getBucketRanges: (data.getBucketRanges ?? data.getBucketRange).map(([name, args, expected], i) => entry(`${name}-${i}`, args, expected)),
  chooseVariation: data.chooseVariation.map(([name, n, ranges, expected], i) => entry(`${name}-${i}`, [n, ranges], expected)),
  getEqualWeights: data.getEqualWeights.map(([n, expected], i) => entry(`equal-${n}-${i}`, [n], expected)),
}
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]))
  return value
}
// Validate all fixtures before creating the output directory or writing anything.
const outputs = Object.entries(fixtures).map(([symbol, cases]) => {
  if (!cases.length || new Set(cases.map(c => c.name)).size !== cases.length) throw new Error(`Invalid cases for ${symbol}`)
  return [`sdk.${symbol}.json`, JSON.stringify(sorted({ source: { repo: 'growthbook/growthbook', sha: ref, module, symbol }, cases }), null, 2) + '\n', cases.length]
})
await mkdir(out, { recursive: true })
for (const [name, json, count] of outputs) {
  await writeFile(resolve(out, name), json)
  console.log(`${name}: ${count} cases`)
}
