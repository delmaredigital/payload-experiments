import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// 'use client' entries whose graph imports CSS; loaded only through Payload's
// importMap and Next's bundler (exp-orch 2026-10-31 01:30).
export const NODE_ESM_EXEMPT_ENTRIES = Object.freeze(['./admin/client', './puck/editor'])

export function isExemptEntry(entry) {
  return NODE_ESM_EXEMPT_ENTRIES.includes(entry)
}

/** Pure export selection, so tests can inspect the real map without loading dist. */
export function listExportTargets(exportsMap) {
  return Object.entries(exportsMap).filter(([entry, conditions]) =>
    !(entry === './package.json' && conditions === './package.json') &&
    // CSS is consumed by the host's stylesheet pipeline, not the Node loader.
    !(entry === './puck/editor.css' && conditions === './dist/puck/editor/editor.css')
  ).map(([entry, conditions]) => ({
    entry,
    exempt: isExemptEntry(entry),
    targets: [...new Set([conditions.import, conditions.default])],
  }))
}

async function checkNodeEsm() {
  const packageURL = new URL('../package.json', import.meta.url)
  const pkg = JSON.parse(await readFile(packageURL, 'utf8'))
  const failures = []
  for (const { entry, exempt, targets } of listExportTargets(pkg.exports)) {
    if (exempt) {
      console.log(`Skipped ${entry}: CSS-bearing 'use client' entry (Payload importMap / Next bundler)`)
      continue
    }
    for (const target of targets) {
      try {
        if (typeof target !== 'string' || !target.startsWith('./dist/')) {
          throw new Error('Expected an import/default target under ./dist/')
        }
        // No bundler, loader, source condition or transpilation: use plain Node ESM.
        await import(new URL(target, packageURL).href)
        console.log(`Loaded ${entry}: ${target}`)
      } catch (error) {
        failures.push(`${entry} (${String(target)}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  if (failures.length) {
    console.error(`Node ESM entry failures (${failures.length}):\n${failures.join('\n')}`)
    process.exitCode = 1
  }
}

// Importing the pure helpers does not execute the post-build check.
if (process.argv[1] && pathToFileURL(realpathSync(resolve(process.argv[1]))).href === pathToFileURL(realpathSync(new URL(import.meta.url))).href) {
  await checkNodeEsm()
}
