import type { Payload, PayloadRequest } from 'payload'
import { fakePayload } from './payload.js'

export interface FakeRequestOptions {
  user?: PayloadRequest['user'] | { id: string | number; [key: string]: unknown } | null
  context?: PayloadRequest['context']
  transactionID?: PayloadRequest['transactionID']
  payload?: Payload
  headers?: HeadersInit
  routeParams?: PayloadRequest['routeParams']
  searchParams?: URLSearchParams | string
  method?: string
  url?: string
  body?: string | Uint8Array
}

export type FakeRequest = PayloadRequest & Pick<Request, 'headers' | 'method' | 'url' | 'body' | 'bodyUsed' | 'json' | 'text'> & { searchParams: URLSearchParams }

export function fakeReq({ user = null, context = {}, transactionID, payload = fakePayload(), headers, routeParams = {}, searchParams, body, method = body === undefined ? 'GET' : 'POST', url = 'https://example.test/api/xp/events' }: FakeRequestOptions = {}): FakeRequest {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body?.slice()
  // Use the native Request reader methods so stream consumption and bodyUsed match Fetch.
  const request = new Request(url, { method: bytes === undefined ? method : 'POST', headers, body: bytes })
  return {
    user, context, transactionID, payload, headers: request.headers, routeParams,
    searchParams: new URLSearchParams(searchParams ?? new URL(url).search),
    method, url, body: request.body,
    get bodyUsed() { return request.bodyUsed },
    json: () => request.json(), text: () => request.text(),
  } as FakeRequest
}
