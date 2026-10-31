import type { Payload, PayloadRequest } from 'payload'
import type { NextRequest } from 'next/server'
import type { Attributes } from './contracts.js'
import type { Manifest } from './manifest.js'

type User = NonNullable<PayloadRequest['user']>
export interface ExperimentsProxyRuntimeOptions {
  secret: string | string[]
  apiRoute: string
  cookie?: { name?: string; maxAgeDays?: number; domain?: string; consent?(req: NextRequest): boolean }
  loadManifest?: () => Promise<Manifest>
  getUnit?: (req: NextRequest) => { userId?: string; attributes: Attributes; sessionUnknown?: boolean } | Promise<{ userId?: string; attributes: Attributes; sessionUnknown?: boolean }>
}
export interface ExperimentsProxyRuntime {
  readonly secrets: string[]
  readonly apiRoute: string
  readonly cookie: { name: string; maxAgeDays: number; domain?: string; consent?(req: NextRequest): boolean }
  readonly loadManifest?: ExperimentsProxyRuntimeOptions['loadManifest']
  readonly getUnit?: ExperimentsProxyRuntimeOptions['getUnit']
}
export interface ExperimentsServerRuntimeOptions {
  getPayload: () => Promise<Payload>
  getUser?: () => User | null | Promise<User | null>
  userIdOf?: (user: User) => string
  attributesOf?: (user: User | null) => Partial<Attributes>
}
export interface ExperimentsServerRuntime {
  proxyRuntime: ExperimentsProxyRuntime
  getPayload: ExperimentsServerRuntimeOptions['getPayload']
  getUser?: ExperimentsServerRuntimeOptions['getUser']
  userIdOf: NonNullable<ExperimentsServerRuntimeOptions['userIdOf']>
  attributesOf: NonNullable<ExperimentsServerRuntimeOptions['attributesOf']>
}
