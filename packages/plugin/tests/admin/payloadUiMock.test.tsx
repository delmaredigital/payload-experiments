// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { payloadUiMock, resetPayloadUiMock, setEntityConfig, toast } from './_helpers/payloadUiMock.js'

const { useConfig, FieldDescription, TextareaInput, CheckboxInput } = payloadUiMock()
afterEach(() => { cleanup(); resetPayloadUiMock() })
test('mock descriptions, textareas and checkboxes render and accept changes', () => {
  const textChange = vi.fn(), checkChange = vi.fn()
  render(<>
    <FieldDescription path="note" description="Explain the choice." />
    <TextareaInput label="Note" path="note" onChange={textChange} />
    <CheckboxInput label="Confirm" path="confirm" onToggle={checkChange} />
  </>)
  expect(screen.getByText('Explain the choice.').id).toBe('note-description')
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Ship it' } })
  fireEvent.click(screen.getByLabelText('Confirm'))
  expect(textChange).toHaveBeenCalledOnce()
  expect(checkChange).toHaveBeenCalledOnce()
})
test('getEntityConfig returns the controllable value and resets', () => {
  function EntityName() {
    const { getEntityConfig } = useConfig()
    return <span>{(getEntityConfig() as { slug?: string } | undefined)?.slug ?? 'No entity'}</span>
  }
  render(<EntityName />)
  expect(screen.getByText('No entity')).toBeTruthy()
  act(() => setEntityConfig({ slug: 'xp-experiments' }))
  expect(screen.getByText('xp-experiments')).toBeTruthy()
  act(resetPayloadUiMock)
  expect(screen.getByText('No entity')).toBeTruthy()
})
test('reset clears toast and all its member mocks', () => {
  toast('message')
  for (const member of [toast.success, toast.error, toast.info, toast.warning, toast.loading, toast.dismiss, toast.promise]) member('message')
  resetPayloadUiMock()
  expect(toast).not.toHaveBeenCalled()
  for (const member of Object.values(toast)) if (vi.isMockFunction(member)) expect(member).not.toHaveBeenCalled()
})
