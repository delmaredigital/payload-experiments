import { verify } from '../runtime/signing.js'

/** Authenticate before a revision can trigger I/O. Entry/phase validation stays in the shared decoder. */
export function verifiedHeaderRevision(value: string | null, opts: { secrets: readonly string[]; visitorId?: string; userId?: string }): number | null {
  if (!value || Buffer.byteLength(value) > 1024) return null
  const parts = value.split('.')
  if (parts.length !== 5) return null
  const [version, revision, flags, entries, mac] = parts as [string, string, string, string, string]
  if (version !== 'v1' || !/^(0|[1-9]\d*)$/.test(revision) || !Number.isSafeInteger(Number(revision))) return null
  if (!/^[sbpu]*$/.test(flags) || new Set(flags).size !== flags.length) return null
  return verify(`xp:assign:${opts.visitorId ?? ''}|${opts.userId ?? ''}|${flags}|${entries}|${revision}`, mac, opts.secrets) ? Number(revision) : null
}
