import type { Payload } from 'payload'
import type { NextRequest } from 'next/server'
import type { Attributes } from './contracts.js'
import type { Manifest } from './manifest.js'

export interface ExperimentsProxyRuntimeOptions {
  secret: string | string[]
  apiRoute: string
  cookie?: { name?: string; maxAgeDays?: number; domain?: string; consent?(req: NextRequest): boolean }
  loadManifest?: (opts?: { ifRevision?: number }) => Promise<Manifest | 'not-modified' | null>
  getUnit?: (req: NextRequest) => { userId?: string; attributes: Attributes; sessionUnknown?: boolean } | Promise<{ userId?: string; attributes: Attributes; sessionUnknown?: boolean }>
}
export interface ExperimentsProxyRuntime {
  readonly secrets: readonly string[]
  readonly apiRoute: string
  readonly cookie: { name: string; maxAgeDays: number; domain?: string; consent?(req: NextRequest): boolean }
  readonly loadManifest?: ExperimentsProxyRuntimeOptions['loadManifest']
  readonly getUnit?: ExperimentsProxyRuntimeOptions['getUnit']
}
export interface ExperimentsServerRuntimeOptions<TUser extends { id: string | number } = { id: string | number }> {
  getPayload: () => Promise<Payload>
  getUser?: () => Promise<TUser | null>
  userIdOf?: (user: TUser) => string
  attributesOf?: (user: TUser | null) => Partial<Attributes>
}
export interface ExperimentsServerRuntime<TUser extends { id: string | number } = { id: string | number }> {
  proxyRuntime: ExperimentsProxyRuntime
  getPayload: ExperimentsServerRuntimeOptions<TUser>['getPayload']
  getUser?: ExperimentsServerRuntimeOptions<TUser>['getUser']
  userIdOf: NonNullable<ExperimentsServerRuntimeOptions<TUser>['userIdOf']>
  attributesOf: NonNullable<ExperimentsServerRuntimeOptions<TUser>['attributesOf']>
}
