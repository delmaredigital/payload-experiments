import type { Payload } from 'payload'
import type { DocId } from '../../src/types/contracts.js'

export type FakeDocument = Record<string, unknown> & { id: DocId }
export type FakePayloadCall = { method: 'find' | 'findByID' | 'create' | 'update' | 'delete'; args: Record<string, unknown> }
type Args = { collection: string; id?: DocId; data?: Record<string, unknown>; where?: Record<string, unknown>; limit?: number; page?: number; overrideAccess?: boolean; [key: string]: unknown }

/** Deliberately small Local API fake: it records access posture, but never authorises it. */
export function fakePayload({ collections = {} }: { collections?: Record<string, FakeDocument[]> } = {}) {
  const documents = structuredClone(collections)
  const calls: FakePayloadCall[] = []
  const sessions: Record<string, { db: unknown; resolve: () => Promise<void>; reject: () => Promise<void> }> = {}
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
    calls, documents, db: { sessions },
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
  return api as unknown as Payload & Pick<typeof api, 'calls' | 'documents'> & { db: { sessions: typeof sessions } }
}
