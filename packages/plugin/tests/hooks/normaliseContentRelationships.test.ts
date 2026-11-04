import type { Block, Field } from 'payload'
import { expect, test } from 'vitest'
import { normaliseContentRelationships } from '../../src/server/normaliseContentRelationships.js'

test('schema traversal covers layouts, named tabs, groups, arrays and referenced blocks without changing JSON or inputs', () => {
  const fields: Field[] = [{ type: 'tabs', tabs: [
    { label: 'Content', fields: [{ type: 'row', fields: [{ type: 'collapsible', label: 'Links', fields: [
      { name: 'image', type: 'upload', relationTo: 'media' },
    ] }] }] },
    { name: 'details', fields: [{ name: 'group', type: 'group', fields: [
      { name: 'rows', type: 'array', fields: [{ name: 'link', type: 'relationship', relationTo: ['pages', 'media'] }] },
    ] }] },
  ] }, { name: 'layout', type: 'blocks', blocks: [], blockReferences: ['linked'] },
  { name: 'json', type: 'json' }]
  const blocks: Block[] = [{ slug: 'linked', fields: [{ name: 'images', type: 'upload', relationTo: 'media', hasMany: true }] }]
  const data = { image: { id: 1, filename: 'image.png' }, details: { group: { rows: [
    { link: { relationTo: 'pages', value: { id: 'page', title: 'Page' } } },
  ] } }, layout: [{ blockType: 'linked', images: [{ id: 2 }, 3] }],
  json: { type: 'upload', value: { id: 4 }, id: 5, title: 'Keep this content' } }
  const original = structuredClone(data)
  expect(normaliseContentRelationships(data, fields, blocks)).toEqual({ ...data, image: 1,
    details: { group: { rows: [{ link: { relationTo: 'pages', value: 'page' } }] } },
    layout: [{ blockType: 'linked', images: [2, 3] }],
  })
  expect(data).toEqual(original)
})

test('rich text normalises only upload/relationship node values and preserves text, attributes and ids', () => {
  const fields: Field[] = [{ name: 'body', type: 'richText' }]
  const data = { body: { root: { children: [{ type: 'paragraph', children: [
    { type: 'upload', relationTo: 'media', value: { id: 1, filename: 'image.png' } },
    { type: 'relationship', relationTo: 'pages', value: { id: 'p', title: 'Page' } },
    { type: 'text', text: 'Words', value: { id: 3, title: 'Keep' } },
  ] }] } } }
  const result = normaliseContentRelationships(data, fields) as typeof data
  expect(result.body.root.children[0]!.children).toEqual([
    { type: 'upload', relationTo: 'media', value: 1 },
    { type: 'relationship', relationTo: 'pages', value: 'p' },
    data.body.root.children[0]!.children[2],
  ])
  expect(normaliseContentRelationships(result, fields)).toEqual(result)
})

test('null, missing and unpopulated relationships stay unchanged; linked id changes remain visible', () => {
  const fields: Field[] = [{ name: 'link', type: 'relationship', relationTo: 'pages' },
    { name: 'links', type: 'relationship', relationTo: ['pages', 'media'], hasMany: true }]
  for (const data of [undefined, null, {}, { link: null }, { link: 'p', links: [{ relationTo: 'pages', value: 'p' }] }]) {
    expect(normaliseContentRelationships(data, fields)).toEqual(data)
  }
  expect(normaliseContentRelationships({ link: { id: 'new' } }, fields)).not.toEqual({ link: 'old' })
})

test('locale all: a localized relationship map is normalised per locale, and a same-shaped group without locales is left alone', () => {
  const fields = [
    { name: 'image', type: 'upload', relationTo: 'media', localized: true },
    { name: 'meta', type: 'group', fields: [{ name: 'en', type: 'text' }] },
  ] as never
  const doc = { image: { en: { id: 1, url: '/a.png' }, fr: 2 }, meta: { en: 'kept' } }
  expect(normaliseContentRelationships(doc, fields, [], ['en', 'fr'])).toEqual({ image: { en: 1, fr: 2 }, meta: { en: 'kept' } })
  expect(normaliseContentRelationships(doc, fields)).toEqual(doc)
  expect(doc.image.en).toEqual({ id: 1, url: '/a.png' })
})

