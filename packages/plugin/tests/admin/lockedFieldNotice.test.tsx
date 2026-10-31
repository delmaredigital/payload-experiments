// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { payloadUiMock, resetPayloadUiMock, setFormFields, setDocumentInfo } from './_helpers/payloadUiMock.js'
import { LockedFieldNotice } from '../../src/admin/LockedFieldNotice.js'

vi.mock('@payloadcms/ui', () => payloadUiMock())
// CORE-03 owns the real table. Keep this shell test independent of its stub.
vi.mock('../../src/collections/experiments/editability.js', () => ({ EDITABLE_BY_STATUS: {
  draft: ['name', 'hypothesis', 'arms', 'analysis'], stopped: ['name', 'hypothesis', 'arms'],
  running: ['name', 'hypothesis'], decided: ['name', 'hypothesis'], archived: [],
} }))
afterEach(() => { cleanup(); resetPayloadUiMock() })
test('hidden for an editable field, using admin.custom.field rather than its nested path', () => {
  setFormFields({ status: { value: 'draft' } })
  const { container } = render(<LockedFieldNotice path="groups.arms" field={{ name: 'arms', type: 'text', admin: { custom: { field: 'arms' } } }} />)
  expect(container.textContent).toBe('')
  act(() => setFormFields({ status: { value: 'running' } }))
  expect(screen.getByText('Locked while the test is running so everyone in this round sees the same thing. Stop the test to change it.')).toBeTruthy()
})
test('falls back to path and shows the creation reason', () => {
  setFormFields({ status: { value: 'stopped' } })
  render(<LockedFieldNotice path="slug" field={{ name: 'slug', type: 'text' }} />)
  expect(screen.getByText('Set when the experiment was created.')).toBeTruthy()
})
test('no saved status renders nothing', () => {
  const { container } = render(<LockedFieldNotice path="arms" field={{ name: 'arms', type: 'text' }} />)
  expect(container.textContent).toBe('')
})

test('keeps the field description when editable and above the reason when locked', () => {
  setFormFields({ status: { value: 'draft' } })
  const { container } = render(<LockedFieldNotice path="arms" field={{ name: 'arms', type: 'text', admin: { description: 'Choose the groups.' } }} />)
  expect(screen.getByText('Choose the groups.')).toBeTruthy()
  expect(container.querySelector('.xp-locked-notice')).toBeNull()
  act(() => setFormFields({ status: { value: 'running' } }))
  expect(screen.getByText('Choose the groups.')).toBeTruthy()
  expect(container.textContent).toBe('Choose the groups.Locked while the test is running so everyone in this round sees the same thing. Stop the test to change it.')
})
test.each([undefined, null])('creation with id %s shows only the field description', id => {
  setDocumentInfo({ id })
  setFormFields({ status: { value: 'draft' } })
  const { container } = render(<LockedFieldNotice path="slug" field={{ name: 'slug', type: 'text', admin: { description: 'Choose a unique identifier.' } }} />)
  expect(container.textContent).toBe('Choose a unique identifier.')
  expect(container.querySelector('.xp-locked-notice')).toBeNull()
})
test('falls back to the top-level field for a nested path', () => {
  setFormFields({ status: { value: 'draft' } })
  const { container } = render(<LockedFieldNotice path="analysis.method" field={{ name: 'method', type: 'text' }} />)
  expect(container.textContent).toBe('')
  act(() => setFormFields({ status: { value: 'decided' } }))
  expect(screen.getByText('Locked after the decision.')).toBeTruthy()
})
