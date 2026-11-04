import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const statsPackage = '@delmaredigital/experiments-stats'
const releaseVersion = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')).version
const packageFiles = Object.freeze(['dist', 'LICENSE', 'README.md'])
// Release contract: changes require a separately reviewed compatibility decision.
const peerRanges = Object.freeze({
  payload: '>=3.90.0 <4',
  '@payloadcms/next': '>=3.90.0 <4',
  '@payloadcms/ui': '>=3.90.0 <4',
  '@payloadcms/db-postgres': '>=3.90.0 <4',
  next: '>=16.4.1 <17',
  react: '>=19.2.1 <20',
  'react-dom': '>=19.2.1 <20',
  '@puckeditor/core': '>=0.24.0',
  pg: '>=8.13.0 <9',
})

function isInside(root, path) {
  const name = relative(root, path)
  return name !== '' && name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name)
}

/** Source checks can run without a build; the CLI also checks emitted files. */
export function checkSourcePackage(pkg, root, { checkDist = false } = {}) {
  const failures = []
  if (!pkg.exports || !Object.keys(pkg.exports).length) failures.push('exports must declare package entry points')
  for (const [entry, conditions] of Object.entries(pkg.exports ?? {})) {
    if (entry === './package.json' && conditions === './package.json') continue
    // Public stylesheets have no JavaScript/type conditions.
    if ((entry === './puck/editor.css' && conditions === './dist/puck/editor/editor.css') ||
        (entry === './puck/field.css' && conditions === './dist/puck/field.css')) {
      const source = conditions.replace('./dist/', './src/')
      if (!existsSync(resolve(root, source))) failures.push(`${entry}: missing source counterpart: ${source}`)
      if (checkDist && !existsSync(resolve(root, conditions))) failures.push(`${entry}: missing built target ${conditions}`)
      continue
    }
    for (const condition of ['import', 'types', 'default']) {
      const target = conditions?.[condition]
      if (typeof target !== 'string' || !target.startsWith('./dist/') || !isInside(resolve(root, 'dist'), resolve(root, target))) {
        failures.push(`${entry}.${condition}: expected a path under ./dist/`)
        continue
      }
      const source = target.replace(/^\.\/dist\//, './src/').replace(/(?:\.d\.ts|\.js)$/, '.ts')
      if (!isInside(resolve(root, 'src/exports'), resolve(root, source)) || !existsSync(resolve(root, source))) {
        failures.push(`${entry}.${condition}: missing source counterpart under src/exports/: ${source}`)
      }
      if (checkDist && !existsSync(resolve(root, target))) failures.push(`${entry}.${condition}: missing built target ${target}`)
    }
  }
  if (JSON.stringify(pkg.files) !== JSON.stringify(packageFiles)) failures.push('files must be exactly ["dist", "LICENSE", "README.md"]')
  for (const file of ['LICENSE', 'README.md']) if (!existsSync(resolve(root, file))) failures.push(`Missing ${file}`)
  for (const name of new Set([...Object.keys(peerRanges), ...Object.keys(pkg.peerDependencies ?? {})])) {
    if (!(name in peerRanges) || pkg.peerDependencies?.[name] !== peerRanges[name]) failures.push(`Peer range differs from release contract: ${name}`)
  }
  if (pkg.peerDependenciesMeta?.['@puckeditor/core']?.optional !== true) failures.push('@puckeditor/core must be an optional peer')
  for (const [name, meta] of Object.entries(pkg.peerDependenciesMeta ?? {})) {
    if (name !== '@puckeditor/core' && meta?.optional === true) failures.push(`Unexpected optional peer: ${name}`)
  }
  if (pkg.dependencies?.[statsPackage] !== 'workspace:*') failures.push(`${statsPackage} source dependency must be workspace:*`)
  return failures
}

// Plain npm semver ranges only: versions, wildcards, comparators, unions and
// hyphen ranges. Protocols, tags, aliases and local/git references are excluded.
function isSemverRange(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  const number = '(?:0|[1-9]\\d*)'
  const part = `(?:${number}|[xX*])`
  const identifier = `(?:${number}|[\\da-zA-Z-]*[a-zA-Z-][\\da-zA-Z-]*)`
  const full = `${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[\\da-zA-Z-]+(?:\\.[\\da-zA-Z-]+)*)?`
  const version = `(?:${full}|${part}(?:\\.${part}){0,2})`
  const comparator = `(?:[~^]|[<>]=?|=)?\\s*${version}`
  const range = new RegExp(`^(?:${version}\\s+-\\s+${version}|${comparator}(?:\\s+${comparator})*)$`)
  return value.split('||').every(branch => range.test(branch.trim()))
}

export function checkPackedPackage(pkg) {
  const failures = []
  if (pkg.version !== releaseVersion) failures.push(`Packed version must be ${releaseVersion}`)
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, specifier] of Object.entries(pkg[group] ?? {})) {
      if (typeof specifier === 'string' && specifier.includes('workspace:')) failures.push(`${group}.${name} contains workspace:`)
    }
  }
  if (!isSemverRange(pkg.dependencies?.[statsPackage])) failures.push(`${statsPackage} packed dependency must be a plain semver range`)
  return failures
}

export function checkTarball(tarball) {
  try {
    const json = execFileSync('tar', ['-xzOf', resolve(tarball), 'package/package.json'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    return checkPackedPackage(JSON.parse(json))
  } catch (error) {
    return [`Cannot read packed package.json: ${error.message}`]
  }
}

function main(args) {
  let failures
  if (args.length === 2 && args[0] === '--tarball') failures = checkTarball(args[1])
  else if (args.length) failures = ['Usage: check-package.mjs [--tarball <path.tgz>]']
  else {
    try {
      const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
      failures = checkSourcePackage(pkg, packageRoot, { checkDist: true })
    } catch (error) { failures = [`Cannot read source package.json: ${error.message}`] }
  }
  if (failures.length) {
    console.error(`Package check failures (${failures.length}):\n${failures.join('\n')}`)
    process.exitCode = 1
  } else console.log('Package check passed')
}

// Importing the check helpers never reads dist or executes the CLI.
if (process.argv[1] && pathToFileURL(realpathSync(resolve(process.argv[1]))).href === pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href) {
  main(process.argv.slice(2))
}
