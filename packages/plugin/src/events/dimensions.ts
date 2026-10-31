const identifyingKeys = new Set(['userid', 'visitorid', 'unitid', 'id', 'email', 'emailaddress', 'sessionid', 'session', 'ip', 'ipaddress', 'phone', 'name'])

/** Startup validation; hosts may supply options from JavaScript or config files. */
export function validateDimensions(names: unknown): void {
  if (names === undefined) return
  if (!Array.isArray(names) || names.length > 8) {
    throw new Error('Experiments events.dimensions must be an array of at most 8 unique attribute names')
  }
  const seen = new Set<string>()
  for (const name of names) {
    if (typeof name === 'string' && identifyingKeys.has(name.toLowerCase().replace(/[_-]/g, ''))) {
      throw new Error(`Experiments events.dimensions forbids identifying key: ${name}`)
    }
    if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(name)) {
      throw new Error('Experiments events.dimensions names must match ^[a-zA-Z][a-zA-Z0-9_]{0,39}$')
    }
    if (seen.has(name)) throw new Error(`Experiments events.dimensions names must be unique: ${name}`)
    seen.add(name)
  }
}

/** Pick only server-computed request attributes; never pass browser event data. */
export function exposureDimensions(attributes: Readonly<Record<string, unknown>>, names: readonly string[] = []): Record<string, string | number | boolean> | null {
  const entries: Array<[string, string | number | boolean]> = []
  for (const name of names) {
    if (!Object.hasOwn(attributes, name)) continue
    const value = attributes[name]
    if (typeof value === 'string') {
      const truncated = Array.from(value).slice(0, 64).join('')
      // JSONB rejects NUL and unpaired UTF-16 surrogates. Optional telemetry
      // must never make an otherwise valid exposure fail to persist.
      if (!/\u0000|[\uD800-\uDFFF]/u.test(truncated)) entries.push([name, truncated])
    }
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) entries.push([name, value])
  }
  return entries.length ? Object.fromEntries(entries) : null
}
