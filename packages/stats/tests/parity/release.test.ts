import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { pending } from './pending.js'

it('never releases pending fixtures beyond the skeleton version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
  if (pkg.version !== '0.0.0') expect(pending.size).toBe(0)
  else expect(pkg.version).toBe('0.0.0')
})
