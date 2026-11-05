'use client'

import type { ClientAssignments } from '../types/assignments.js'
import { CLICK_KEY } from '../goals/key.js'
import { sendEvent } from './beacon.js'
import { idempotencyKey } from './idempotency.js'

type Registration = { depth: number; value: ClientAssignments; pageviewId: string }
const providers = new Map<symbol, Registration>()
let listening: Document | undefined

function onClick(event: MouseEvent): void {
  let owner: Registration | undefined
  for (const provider of providers.values()) {
    if (provider.value.clickGoalsArmed && (!owner || provider.depth >= owner.depth)) owner = provider
  }
  if (!owner) return
  const target = event.target
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  const key = element?.closest('[data-xp-goal]')?.getAttribute('data-xp-goal')
  if (!key || !CLICK_KEY.test(key)) return
  sendEvent(owner.value.apiRoute, { type: 'conversion', eventName: `click:${key}`, idempotencyKey: `${owner.pageviewId}:${key}` })
}

/** One delegated listener; depth, rather than React's child-first commit order, decides ownership. */
export function registerClickGoals(token: symbol, depth: number, value: ClientAssignments): void {
  const previous = providers.get(token)
  const pageviewId = previous?.value === value ? previous.pageviewId : idempotencyKey()
  providers.delete(token)
  providers.set(token, { depth, value, pageviewId })
  if (!listening && typeof document !== 'undefined') {
    listening = document
    listening.addEventListener('click', onClick)
  }
}
export function unregisterClickGoals(token: symbol): void {
  providers.delete(token)
  if (!providers.size && listening) {
    listening.removeEventListener('click', onClick)
    listening = undefined
  }
}
