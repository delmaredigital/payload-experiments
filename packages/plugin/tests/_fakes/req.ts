import type { Payload, PayloadRequest } from 'payload'
import { fakePayload } from './payload.js'

export function fakeReq({ user = null, context = {}, transactionID, payload = fakePayload() }: {
  user?: PayloadRequest['user'] | { id: string | number; [key: string]: unknown } | null
  context?: PayloadRequest['context']
  transactionID?: PayloadRequest['transactionID']
  payload?: Payload
} = {}): PayloadRequest {
  return { user, context, transactionID, payload, headers: new Headers() } as PayloadRequest
}
