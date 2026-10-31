import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as publicApi from '../../src/index.js'
import { FIXTURE_DIR, loadFixture } from './fixtures.js'
import { manifest, PIN } from './manifest.js'
import { pending } from './pending.js'
import { runners } from './runners.js'

const sourceDir = fileURLToPath(new URL('../../src/', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

// Parse function bodies rather than searching the entire module for a sentinel:
// an implemented function may legitimately share a module with a pending stub.
const functions = sourceFiles(sourceDir).flatMap(path => {
  const text = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const declarations: Array<{ module: string; name: string; body: string }> = []
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      declarations.push({
        module: relative(sourceDir, path).replace(/\.ts$/, ''),
        name: node.name.text,
        body: node.body.getText(file),
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return declarations
})

describe('parity coverage', () => {
  it('maps every public runtime function and every declared manifest key', () => {
    const keys = manifest.map(entry => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const [name, value] of Object.entries(publicApi)) {
      if (typeof value === 'function') expect(keys, name).toContain(name)
    }
    expect(Object.keys(runners).sort()).toEqual([...keys].sort())
    for (const entry of manifest) expect(typeof runners[entry.key], entry.key).toBe('function')
    expect(new Set(manifest.map(entry => entry.fixture)).size).toBe(manifest.length)
    for (const fixture of pending) expect(manifest.some(entry => entry.fixture === fixture), fixture).toBe(true)
  })

  it('requires active fixtures to have cases and the correct provenance', () => {
    for (const entry of manifest) {
      const path = join(FIXTURE_DIR, `${entry.fixture}.json`)
      if (pending.has(entry.fixture)) {
        expect(existsSync(path), `${entry.fixture}: remove it from pending.ts`).toBe(false)
        continue
      }
      expect(existsSync(path), path).toBe(true)
      const fixture = loadFixture(entry.fixture)
      if (!fixture) throw new Error(`Missing active fixture: ${entry.fixture}`)
      expect(fixture.cases.length, entry.fixture).toBeGreaterThanOrEqual(1)
      expect(fixture.source.symbol, entry.fixture).toBe(entry.symbol)
      if (!process.env.XP_FIXTURE_DIR && fixture.source.repo === 'growthbook/growthbook') {
        expect(fixture.source.sha, entry.fixture).toBe(PIN)
      }
    }
  })

  it('rejects orphan fixture files', () => {
    const files = new Set(manifest.map(entry => `${entry.fixture}.json`))
    for (const name of readdirSync(FIXTURE_DIR)) {
      if (name !== '.gitkeep') expect(files.has(name), `Orphan fixture: ${name}`).toBe(true)
    }
  })

  it('statically requires every stub body to remain pending', () => {
    for (const entry of manifest) {
      const [module, name] = entry.key.includes('#') ? entry.key.split('#') : [undefined, entry.key]
      const matches = functions.filter(fn => fn.name === name && (module === undefined || fn.module === module))
      expect(matches.length, `Function body for ${entry.key}`).toBe(1)
      if (!pending.has(entry.fixture)) {
        expect(matches[0]!.body, entry.key).not.toContain('not implemented: ')
      }
    }
  })
})
