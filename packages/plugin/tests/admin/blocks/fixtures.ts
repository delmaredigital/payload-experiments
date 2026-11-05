import type { Block, ClientCollectionConfig, ClientConfig, ClientField, Field } from 'payload'
import { vi } from 'vitest'
import { createExperimentBlock } from '../../../src/blocks/createExperimentBlock.js'
import type { HostBlock } from '../../../src/blocks/model.js'
import { dataAt } from '../../../src/admin/blocks/formApi.js'
import { setPayloadUiState } from '../_helpers/payloadUiMock.js'
export const hero: Block = { slug: 'hero', labels: { singular: 'Hero', plural: 'Heroes' }, fields: [
  { name: 'items', type: 'array', fields: [{ name: 'text', type: 'text' }] },
  { name: 'children', type: 'blocks', blocks: [{ slug: 'text', fields: [{ name: 'text', type: 'text' }] }] },
] }
export const field: Extract<Field, { type: 'blocks' }> = { name: 'layout', type: 'blocks', blocks: [hero, { slug: 'plain', fields: [] }, createExperimentBlock({ blocks: [hero] })] }
export const original: HostBlock = { id: 'hero-id', blockType: 'hero', items: [{ id: 'nested-array', text: 'hello' }], children: [{ id: 'nested-block', blockType: 'text', text: 'hello' }] }
export const collection = { slug: 'pages', admin: { useAsTitle: 'title' }, labels: { singular: 'Page', plural: 'Pages' }, versions: { drafts: true }, fields: [field] } as unknown as ClientCollectionConfig
export const config = { collections: [collection], globals: [], routes: { api: '/api', admin: '/cms' }, blocks: [] } as unknown as ClientConfig
export const clientField = field as unknown as Extract<ClientField, { type: 'blocks' }>
export function configure(data: Record<string, unknown>) {
  const form = { getData: vi.fn(() => data), getDataByPath: vi.fn((path: string) => dataAt(data, path)), getFields: vi.fn(() => ({})),
    dispatchFields: vi.fn(), setModified: vi.fn(), replaceFieldRow: vi.fn(), addFieldRow: vi.fn(), removeFieldRow: vi.fn() }
  setPayloadUiState({ config: { config }, entityConfig: collection, auth: { permissions: { collections: { 'xp-experiments': { update: true } } } },
    documentInfo: { id: '1', collectionSlug: 'pages', data: {}, getDocPreferences: async () => ({ fields: {} }) }, form,
    rowLabel: { path: 'layout.0.slots.1', data: { slot: 'variantA' } },
    serverFunctions: { getFormState: vi.fn(async () => ({ state: {} })) },
  })
  return form
}
