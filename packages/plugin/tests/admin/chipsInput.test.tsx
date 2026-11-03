// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ChipsInput } from '../../src/admin/components/ChipsInput.js'

afterEach(cleanup)
function setup(value: string[] = [], disabled = false) {
  const changed = vi.fn()
  function Example() {
    const [chips, setChips] = useState(value)
    return <ChipsInput id="paths" label="Page paths" description="Add page paths." placeholder="Type a value and press Enter" disabled={disabled}
      value={chips} onChange={next => { changed(next); setChips(next) }} />
  }
  render(<Example />)
  return { input: screen.getByRole('textbox', { name: 'Page paths' }) as HTMLInputElement, changed }
}

test.each(['Enter', ',', 'Tab'])('%s commits trimmed chips and clears typing', key => {
  const { input, changed } = setup()
  fireEvent.change(input, { target: { value: ' /welcome ' } })
  expect(changed).not.toHaveBeenCalled()
  const allowDefault = fireEvent.keyDown(input, { key })
  expect(changed).toHaveBeenLastCalledWith(['/welcome'])
  expect(input.value).toBe('')
  expect(allowDefault).toBe(key === 'Tab')
  expect(screen.getByRole('button', { name: 'Remove /welcome' })).toBeTruthy()
})
test('blur commits a trimmed draft once and ignores empty drafts', () => {
  const { input, changed } = setup(['/home'])
  fireEvent.change(input, { target: { value: ' /welcome ' } })
  expect(changed).not.toHaveBeenCalled()
  fireEvent.blur(input)
  expect(changed).toHaveBeenCalledExactlyOnceWith(['/home', '/welcome'])
  expect(input.value).toBe('')
  expect(screen.getByRole('button', { name: 'Remove /welcome' })).toBeTruthy()
  fireEvent.blur(input)
  fireEvent.change(input, { target: { value: '   ' } })
  fireEvent.blur(input)
  expect(changed).toHaveBeenCalledTimes(1)
})
test('comma-separated paste trims, drops empty values and deduplicates case-sensitively', () => {
  const { input, changed } = setup(['a'])
  fireEvent.paste(input, { clipboardData: { getData: () => ' a, b, , c, b, A ' } })
  expect(changed).toHaveBeenLastCalledWith(['a', 'b', 'c', 'A'])
  expect(screen.getAllByRole('button')).toHaveLength(4)
})
test('duplicate and empty commits are no-ops', () => {
  const { input, changed } = setup(['a'])
  for (const value of [' a ', '   ', '']) {
    fireEvent.change(input, { target: { value } }); fireEvent.keyDown(input, { key: 'Enter' })
  }
  expect(changed).not.toHaveBeenCalled()
  expect(screen.getAllByRole('button')).toHaveLength(1)
})
test('remove button and Backspace remove chips and retain input focus', () => {
  const { input, changed } = setup(['a', 'b', 'c'])
  fireEvent.click(screen.getByRole('button', { name: 'Remove b' }))
  expect(changed).toHaveBeenLastCalledWith(['a', 'c'])
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: 'draft' } })
  fireEvent.keyDown(input, { key: 'Backspace' })
  expect(changed).toHaveBeenCalledTimes(1)
  fireEvent.change(input, { target: { value: '' } }); fireEvent.keyDown(input, { key: 'Backspace' })
  expect(changed).toHaveBeenLastCalledWith(['a'])
})
test('visible label, group, help and disabled state are accessible', () => {
  const { input, changed } = setup(['a'], true)
  const group = screen.getByRole('group', { name: 'Page paths' })
  expect(group.getAttribute('aria-disabled')).toBe('true')
  expect(group.hasAttribute('aria-describedby')).toBe(false)
  expect(input.id).toBe('paths')
  expect(input.getAttribute('aria-describedby')).toBe(screen.getByText('Add page paths.').id)
  expect(input.disabled).toBe(true)
  const remove = screen.getByRole('button', { name: 'Remove a' }) as HTMLButtonElement
  expect(remove.disabled).toBe(true)
  fireEvent.click(remove); fireEvent.keyDown(input, { key: 'Backspace' })
  fireEvent.paste(input, { clipboardData: { getData: () => 'b, c' } })
  fireEvent.change(input, { target: { value: 'draft' } }); fireEvent.blur(input)
  expect(changed).not.toHaveBeenCalled()
})
test('composition Enter does not commit; paste respects the current selection', () => {
  const { input, changed } = setup()
  fireEvent.change(input, { target: { value: 'draft' } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  expect(changed).not.toHaveBeenCalled()
  input.setSelectionRange(0, 5)
  fireEvent.paste(input, { clipboardData: { getData: () => 'a, b' } })
  expect(changed).toHaveBeenLastCalledWith(['a', 'b'])
})
