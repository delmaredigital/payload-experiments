import { readFile } from 'node:fs/promises'

const packageURL = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(await readFile(packageURL, 'utf8'))
const loaded = new Set()
for (const [entry, conditions] of Object.entries(pkg.exports)) {
  for (const condition of ['import', 'default']) {
    const target = conditions[condition]
    if (typeof target !== 'string' || !target.startsWith('./dist/')) {
      throw new Error(`${entry} has no dist target for ${condition}`)
    }
    if (loaded.has(target)) continue
    // No bundler, loader, source condition or transpilation: use plain Node ESM.
    await import(new URL(target, packageURL).href)
    loaded.add(target)
    console.log(`Loaded ${entry}: ${target}`)
  }
}
