import { expect, test } from 'vitest'
import { payloadOperations } from './payloadOperations.js'

test('Payload default access operation sets are visible when the dependency changes', async () => {
  const { collectionOperations, globalOperations } = await payloadOperations()
  // Payload 3.90.2 defaults; the payload-4 merge updates these expectations.
  expect(collectionOperations.sort()).toEqual(['create', 'delete', 'read', 'unlock', 'update'])
  expect(globalOperations.sort()).toEqual(['read', 'update'])
})
