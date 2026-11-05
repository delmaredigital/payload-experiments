import type { Payload } from 'payload'
import type { DocId } from '../../src/types/contracts.js'
import { createFakeExecutor } from './executor.js'
import type { FakeExecutor } from './executor.js'

export type FakeDocument = Record<string, unknown> & { id: DocId }
export type FakePayloadCall = { method: 'find' | 'findByID' | 'create' | 'update' | 'delete'; args: Record<string, unknown> }
type Args = { collection: string; id?: DocId; data?: Record<string, unknown>; where?: Record<string, unknown>; limit?: number; page?: number; overrideAccess?: boolean; [key: string]: unknown }
type TransactionID = DocId | Promise<DocId>
export interface FakeTransactionOptions {
  begin?: DocId | null | Error | (() => DocId | null | Promise<DocId | null>)
  commit?: Error | ((id: DocId) => void | Promise<void>)
  rollback?: Error | ((id: DocId) => void | Promise<void>)
}
export type FakeDatabaseCall = { method: 'beginTransaction' | 'commitTransaction' | 'rollbackTransaction'; args: unknown[] }
export interface FakePayloadOptions<TOverrides extends Record<string, unknown> = Record<string, never>> {
  collections?: Record<string, FakeDocument[]>
  executor?: FakeExecutor
  transactions?: FakeTransactionOptions
  config?: { custom?: Record<string, unknown>; [key: string]: unknown }
  /** Shallow overrides are merged last; a replacement db/logger replaces that entire surface. */
  overrides?: TOverrides
}

/** Deliberately small Local API fake: it records access posture, but never authorises it. */
export function fakePayload<TOverrides extends Record<string, unknown> = Record<string, never>>({ collections = {}, executor = createFakeExecutor(), transactions = {}, config = {}, overrides }: FakePayloadOptions<TOverrides> = {}) {
  const documents = structuredClone(collections)
  const calls: FakePayloadCall[] = []
  const sessions: Record<string, { db: unknown; resolve: () => Promise<void>; reject: () => Promise<void> }> = {}
  const dbCalls: FakeDatabaseCall[] = []
  const logs: Array<{ level: 'info' | 'warn' | 'error' | 'debug'; args: unknown[] }> = []
  let transactionCounter = 0
  const logger = {
    info: (...args: unknown[]) => { logs.push({ level: 'info', args }) },
    warn: (...args: unknown[]) => { logs.push({ level: 'warn', args }) },
    error: (...args: unknown[]) => { logs.push({ level: 'error', args }) },
    debug: (...args: unknown[]) => { logs.push({ level: 'debug', args }) },
  }
  async function finish(method: 'commitTransaction' | 'rollbackTransaction', transactionID: TransactionID) {
    const id = await transactionID
    dbCalls.push({ method, args: [id] })
    const behavior = method === 'commitTransaction' ? transactions.commit : transactions.rollback
    if (behavior instanceof Error) throw behavior
    await behavior?.(id)
    delete sessions[id]
  }
  const db = {
    sessions, drizzle: { execute: executor.execute },
    findOne: (async (args: { collection: string; where?: Record<string, unknown> }) => structuredClone(documents[args.collection]?.find(doc => matches(doc, args.where)))) as Payload['db']['findOne'],
    async beginTransaction(options?: Record<string, unknown>) {
      dbCalls.push({ method: 'beginTransaction', args: options === undefined ? [] : [options] })
      if (transactions.begin instanceof Error) throw transactions.begin
      let defaultID: string
      do { defaultID = `fake-transaction-${++transactionCounter}` } while (sessions[defaultID])
      const id = typeof transactions.begin === 'function' ? await transactions.begin() : transactions.begin === undefined ? defaultID : transactions.begin
      if (id !== null) sessions[id] = {
        db: executor, resolve: () => finish('commitTransaction', id), reject: () => finish('rollbackTransaction', id),
      }
      return id
    },
    commitTransaction: (id: TransactionID) => finish('commitTransaction', id),
    rollbackTransaction: (id: TransactionID) => finish('rollbackTransaction', id),
  }
  function record(method: FakePayloadCall['method'], args: Args) {
    calls.push({ method, args: { ...args } })
    return documents[args.collection] ??= []
  }
  function matches(doc: FakeDocument, where?: Record<string, unknown>): boolean {
    return !where || Object.entries(where).every(([field, condition]) => {
      if (field === 'and' || field === 'or') {
        if (!Array.isArray(condition)) throw new Error(`Invalid fake where: ${field}`)
        const results = condition.map(clause => matches(doc, clause))
        return field === 'and' ? results.every(Boolean) : results.some(Boolean)
      }
      if (typeof condition !== 'object' || condition === null) return doc[field] === condition
      return Object.entries(condition).every(([op, value]) => {
        if (op === 'equals') return doc[field] === value
        if (op === 'in' && Array.isArray(value)) return value.includes(doc[field])
        throw new Error(`Unsupported fake where operator: ${op}`)
      })
    })
  }
  const api = {
    calls, documents, db, dbCalls, logs, logger, config: { ...config, custom: config.custom ?? {} },
    async find(args: Args) {
      const docs = record('find', args).filter(doc => matches(doc, args.where))
      const page = args.page ?? 1, limit = args.limit ?? 10
      const totalPages = limit === 0 ? 1 : Math.max(1, Math.ceil(docs.length / limit))
      return { docs: structuredClone(limit === 0 ? docs : docs.slice((page - 1) * limit, page * limit)), totalDocs: docs.length, limit, page, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1, nextPage: page < totalPages ? page + 1 : null, prevPage: page > 1 ? page - 1 : null, pagingCounter: (page - 1) * limit + 1 }
    },
    async findByID(args: Args) {
      const doc = record('findByID', args).find(doc => doc.id === args.id)
      if (!doc) throw new Error(`Missing fake document: ${args.collection}/${args.id}`)
      return structuredClone(doc)
    },
    async create(args: Args) {
      const docs = record('create', args)
      let id: DocId = args.data?.id as DocId | undefined ?? 1
      if (args.data?.id === undefined) while (docs.some(doc => doc.id === id)) id = Number(id) + 1
      if (docs.some(doc => doc.id === id)) throw new Error(`Duplicate fake id: ${id}`)
      const doc = structuredClone({ ...args.data, id })
      docs.push(doc)
      return structuredClone(doc)
    },
    async update(args: Args) {
      const docs = record('update', args)
      const targets = docs.filter(doc => args.id === undefined ? matches(doc, args.where) : doc.id === args.id)
      if (args.id !== undefined && !targets.length) throw new Error(`Missing fake document: ${args.collection}/${args.id}`)
      for (const doc of targets) Object.assign(doc, structuredClone(args.data), { id: doc.id })
      return structuredClone(args.id === undefined ? { docs: targets, errors: [] } : targets[0])
    },
    async delete(args: Args) {
      const docs = record('delete', args)
      const targets = docs.filter(doc => args.id === undefined ? matches(doc, args.where) : doc.id === args.id)
      if (args.id !== undefined && !targets.length) throw new Error(`Missing fake document: ${args.collection}/${args.id}`)
      documents[args.collection] = docs.filter(doc => !targets.includes(doc))
      return structuredClone(args.id === undefined ? { docs: targets, errors: [] } : targets[0])
    },
  }
  // The only Payload cast lives here; consumers retain the fake's inspection fields.
  return { ...api, ...overrides } as unknown as Payload & typeof api & TOverrides
}
