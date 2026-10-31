// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AllocationField } from '../../../src/admin/AllocationField.js'
import { useLayerUsage } from '../../../src/admin/useLayerUsage.js'
import { resetPayloadUiMock, setField, setFormFields } from '../_helpers/payloadUiMock.js'

vi.mock('@payloadcms/ui', async () => ({ ...(await import('../_helpers/payloadUiMock.js')).payloadUiMock(), FieldError: () => null }))
vi.mock('../../../src/admin/useLayerUsage.js', () => ({ useLayerUsage: vi.fn(() => ({ name: 'Homepage', used: 30, free: 70 })) }))
afterEach(() => { cleanup(); resetPayloadUiMock(); vi.clearAllMocks() })
test.each([7, { id: 7 }])('allocation uses fetched layer usage for relationship %j', layer => {
  setField({ value: 50, setValue: vi.fn() })
  setFormFields({ layer: { value: layer }, arms: { value: [
    { key: 'control', kind: 'control', weight: 50 }, { key: 'variantA', kind: 'variant', weight: 50 },
  ] } })
  render(<AllocationField path="allocation" field={{ name: 'allocation', type: 'number' }} />)
  expect(useLayerUsage).toHaveBeenCalledWith(7)
  expect(screen.getByText('50% of visitors take part: about 25% see each version; the rest see the Original and are not counted. Uses 30 of the 100 slices in layer Homepage; 70 are free.')).toBeTruthy()
})
