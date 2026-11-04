import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const scriptURL = new URL('../../scripts/check-package.mjs', import.meta.url)
const { checkSourcePackage, checkPackedPackage } = await import(scriptURL.href) as {
  checkSourcePackage(pkg: unknown, root: string, options?: { checkDist?: boolean }): string[]
  checkPackedPackage(pkg: unknown): string[]
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const stats = '@delmaredigital/experiments-stats'
const temporary: string[] = []
const tempDir = () => {
  const path = mkdtempSync(join(tmpdir(), 'xp-package-'))
  temporary.push(path)
  return path
}
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })

test('source export counterparts, files and frozen dependency contracts pass without dist', () => {
  expect(pkg.exports['./package.json']).toBe('./package.json')
  expect(pkg.exports['./puck/editor.css']).toBe('./dist/puck/editor/editor.css')
  expect(pkg.exports['./puck/field.css']).toBe('./dist/puck/field.css')
  expect(checkSourcePackage(pkg, root)).toEqual([])
  expect(readFileSync(join(root, 'LICENSE'))).toEqual(readFileSync(new URL('../../../../LICENSE', import.meta.url)))
})

test.each([
  ['./other', './package.json'],
  ['./package.json', './other.json'],
  ['./other.css', './dist/puck/editor/editor.css'],
  ['./puck/editor.css', './src/puck/editor/editor.css'],
  ['./puck/editor.css', './dist/puck/editor/other.css'],
  ['./puck/field.css', './src/puck/field.css'],
  ['./puck/field.css', './dist/puck/other.css'],
])('source check rejects other string-valued exports (%s -> %s)', (entry, target) => {
  const invalid = structuredClone(pkg)
  invalid.exports[entry] = target
  expect(checkSourcePackage(invalid, root)).toEqual(['import', 'types', 'default'].map(condition => `${entry}.${condition}: expected a path under ./dist/`))
})

test('source check reports all changed contracts, including extra and missing peers', () => {
  const invalid = structuredClone(pkg)
  invalid.files = ['dist']
  invalid.peerDependencies.payload = '^3.90.0'
  delete invalid.peerDependencies.next
  invalid.peerDependencies.extra = '*'
  invalid.peerDependenciesMeta['@puckeditor/core'].optional = false
  invalid.peerDependenciesMeta.pg = { optional: true }
  invalid.dependencies[stats] = '^0.1.0'
  expect(checkSourcePackage(invalid, root)).toEqual([
    'files must be exactly ["dist", "LICENSE", "README.md"]',
    'Peer range differs from release contract: payload',
    'Peer range differs from release contract: next',
    'Peer range differs from release contract: extra',
    '@puckeditor/core must be an optional peer',
    'Unexpected optional peer: pg',
    `${stats} source dependency must be workspace:*`,
  ])
})

test('each export condition must stay inside dist and have an existing export source', () => {
  const invalid = structuredClone(pkg)
  invalid.exports['.'].import = './src/exports/index.ts'
  invalid.exports['.'].types = './dist/../src/exports/index.d.ts'
  invalid.exports['.'].default = './dist/exports/missing.js'
  invalid.exports['./proxy'].default = './dist/proxy/resolve.js'
  delete invalid.exports['./proxy'].types
  expect(checkSourcePackage(invalid, root)).toEqual([
    '..import: expected a path under ./dist/',
    '..types: expected a path under ./dist/',
    '..default: missing source counterpart under src/exports/: ./src/exports/missing.ts',
    './proxy.types: expected a path under ./dist/',
    './proxy.default: missing source counterpart under src/exports/: ./src/proxy/resolve.ts',
  ])
})

test('source check reports missing license and readme, and emitted files when requested', () => {
  const emptyRoot = tempDir()
  const failures = checkSourcePackage(pkg, emptyRoot, { checkDist: true })
  expect(failures).toContain('Missing LICENSE')
  expect(failures).toContain('Missing README.md')
  expect(failures).toContain('./puck/editor.css: missing source counterpart: ./src/puck/editor/editor.css')
  expect(failures).toContain('./puck/editor.css: missing built target ./dist/puck/editor/editor.css')
  expect(failures).toContain('./puck/field.css: missing source counterpart: ./src/puck/field.css')
  expect(failures).toContain('./puck/field.css: missing built target ./dist/puck/field.css')
  for (const [entry, conditions] of Object.entries(pkg.exports) as Array<[string, Record<string, string>]>) {
    if (entry === './package.json' && (conditions as unknown) === './package.json') continue
    if (entry === './puck/editor.css' && (conditions as unknown) === './dist/puck/editor/editor.css') continue
    if (entry === './puck/field.css' && (conditions as unknown) === './dist/puck/field.css') continue
    for (const condition of ['import', 'types', 'default']) {
      expect(failures).toContain(`${entry}.${condition}: missing built target ${conditions[condition]}`)
      expect(failures.some(failure => failure.startsWith(`${entry}.${condition}: missing source counterpart`))).toBe(true)
    }
  }
})

function packed(specifier = '0.1.0') {
  return { version: pkg.version, dependencies: { [stats]: specifier } }
}
function tarball(manifest: unknown) {
  const dir = tempDir()
  mkdirSync(join(dir, 'package'))
  writeFileSync(join(dir, 'package/package.json'), JSON.stringify(manifest))
  const path = join(dir, 'fixture with spaces.tgz')
  execFileSync('tar', ['-czf', path, '-C', dir, 'package/package.json'])
  return path
}
function runTarball(path: string) {
  return spawnSync(process.execPath, [fileURLToPath(scriptURL), '--tarball', path], { encoding: 'utf8' })
}

test('tarball CLI accepts a packed semver stats dependency', () => {
  const result = runTarball(tarball(packed()))
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('Package check passed')
})

test('tarball CLI rejects a version that differs from the source package version', () => {
  const result = runTarball(tarball({ ...packed(), version: '0.0.0' }))
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Package check failures (1)')
  expect(result.stderr).toContain(`Packed version must be ${pkg.version}`)
})

test('tarball CLI rejects workspace references across all dependency groups and lists all failures', () => {
  const manifest = {
    ...packed('workspace:*'), version: '0.0.0',
    devDependencies: { dev: 'workspace:^' },
    peerDependencies: { peer: 'workspace:~' },
    optionalDependencies: { optional: 'workspace:*' },
  }
  const result = runTarball(tarball(manifest))
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Package check failures (6)')
  for (const failure of checkPackedPackage(manifest)) expect(result.stderr).toContain(failure)
})

test.each(['0.1.0', '^0.1.0', '~0.1.0', '>=0.1.0 <1', '0.1.0-rc.1', '0.1.x', '0.1.0 - 0.2.0', '^0.1.0 || ^0.2.0'])('packed stats accepts semver range %s', range => {
  expect(checkPackedPackage(packed(range))).toEqual([])
})
test.each(['workspace:*', 'file:../stats', 'link:../stats', 'npm:other@0.1.0', 'https://example.com/stats.tgz', 'latest', '', '01.1.0', '^0.1.0 ||'])('packed stats rejects non-semver specifier %s', specifier => {
  expect(checkPackedPackage(packed(specifier))).toContain(`${stats} packed dependency must be a plain semver range`)
})

test('tarball CLI reports unreadable archives', () => {
  const result = runTarball(join(tempDir(), 'missing.tgz'))
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('Cannot read packed package.json')
})
