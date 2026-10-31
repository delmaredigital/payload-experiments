import { createHmac, timingSafeEqual } from 'node:crypto'

/** New signatures use the first key; verification accepts the entire rotation. */
export function sign(value: string, secrets: readonly string[]): string {
  if (!secrets.length || !secrets[0]) throw new Error('A signing secret is required')
  return createHmac('sha256', secrets[0]).update(value).digest('base64url')
}

export function verify(value: string, mac: string, secrets: readonly string[]): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(mac)) return false
  const supplied = Buffer.from(mac, 'base64url')
  if (supplied.toString('base64url') !== mac) return false
  let valid = false
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret).update(value).digest()
    if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) valid = true
  }
  return valid
}
