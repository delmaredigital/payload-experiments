import { expect, test } from 'vitest'
import { collectionOperations, globalOperations, payloadOperations } from './payloadOperations.js'

test('Payload default access operation sets are visible when the dependency changes', async () => {
  const defaults = await payloadOperations()
  // Payload 3.90.2 defaults; the payload-4 merge updates these expectations.
  expect(defaults.collectionOperations.sort()).toEqual(['create', 'delete', 'read', 'unlock', 'update'])
  expect(defaults.globalOperations.sort()).toEqual(['read', 'update'])
})

test('access operation lists cover every operation Payload defaults', async () => {
  const defaults = await payloadOperations()
  const missingCollection = defaults.collectionOperations.filter(operation => !(collectionOperations as readonly string[]).includes(operation))
  const missingGlobal = defaults.globalOperations.filter(operation => !(globalOperations as readonly string[]).includes(operation))
  expect(missingCollection, `Collection access list is missing Payload operations: ${missingCollection.join(', ')}`).toEqual([])
  expect(missingGlobal, `Global access list is missing Payload operations: ${missingGlobal.join(', ')}`).toEqual([])
})
