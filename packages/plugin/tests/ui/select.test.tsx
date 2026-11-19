// @vitest-environment jsdom
import '../_helpers/popover.js'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { Select } from '../../src/ui/Inputs.js'

afterEach(() => { cleanup(); vi.useRealTimers() })
function Example({ disabled = false, error }: { disabled?: boolean; error?: string }) {
  const [value, set] = useState('apple')
  return <form><Select id="fruit" name="fruit" label="Fruit" help="Pick one." aria-describedby="external" error={error} disabled={disabled}
    value={value} onChange={event => set(event.target.value)} options={[
      { value: 'apple', label: 'Apple' }, { value: 'off', label: 'Unavailable', disabled: true },
      { value: 'banana', label: 'Banana' }, { value: 'berry', label: 'Berry' }, { value: 'cherry', label: 'Cherry' },
    ]} /><button>Next</button></form>
}
function key(key: string) { fireEvent.keyDown(screen.getByRole('combobox'), { key }) }
function active() { return document.getElementById(screen.getByRole('combobox').getAttribute('aria-activedescendant')!)?.textContent }
function formValue() { return new FormData(screen.getByRole('combobox').closest('form')!).get('fruit') }

test.each(['ArrowDown', 'Enter', ' '])('%s opens without changing the value; DOM focus stays on the button', opening => {
  render(<Example />)
  const combo = screen.getByRole('combobox', { name: 'Fruit' }); combo.focus(); key(opening)
  expect(combo.tagName).toBe('BUTTON'); expect(combo.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('listbox').id).toBe(combo.getAttribute('aria-controls'))
  expect(document.activeElement).toBe(combo); expect(active()).toBe('Apple'); expect(formValue()).toBe('apple')
})
test('arrows skip disabled, stop at ends, Home/End and PageUp/PageDown move without committing; Escape cancels', () => {
  render(<Example />); key('ArrowUp'); expect(active()).toBe('Apple')
  key('ArrowUp'); expect(active()).toBe('Apple')
  key('ArrowDown'); expect(active()).toBe('Banana'); expect(formValue()).toBe('apple')
  key('End'); expect(active()).toBe('Cherry'); key('ArrowDown'); expect(active()).toBe('Cherry')
  key('Home'); expect(active()).toBe('Apple')
  key('PageDown'); expect(active()).toBe('Cherry'); key('PageUp'); expect(active()).toBe('Apple')
  key('ArrowDown'); key('Escape')
  expect(screen.queryByRole('listbox')).toBeNull(); expect(formValue()).toBe('apple')
})
test.each(['Enter', ' ', 'Tab'])('%s commits the active value and closes; Tab is not prevented', commit => {
  render(<Example />); key('End')
  const event = new KeyboardEvent('keydown', { key: commit, bubbles: true, cancelable: true })
  fireEvent(screen.getByRole('combobox'), event)
  expect(formValue()).toBe('cherry'); expect(screen.queryByRole('listbox')).toBeNull()
  expect(event.defaultPrevented).toBe(commit !== 'Tab')
})
test('type-ahead opens, matches multi-character prefixes, cycles repeated characters and resets after a delay', () => {
  vi.useFakeTimers(); render(<Example />)
  key('b'); expect(active()).toBe('Banana'); key('b'); expect(active()).toBe('Berry')
  vi.advanceTimersByTime(800); key('b'); key('a'); expect(active()).toBe('Banana')
  vi.advanceTimersByTime(800); key('c'); expect(active()).toBe('Cherry')
  key('Enter'); expect(formValue()).toBe('cherry')
})
test('mouse selection commits, disabled options do nothing, clicking the button cancels and outside click closes', () => {
  render(<Example />); const combo = screen.getByRole('combobox'); combo.focus(); fireEvent.click(combo)
  fireEvent.click(screen.getByRole('option', { name: 'Unavailable' })); expect(formValue()).toBe('apple')
  fireEvent.click(screen.getByRole('option', { name: 'Berry' })); expect(formValue()).toBe('berry')
  expect(document.activeElement).toBe(combo)
  fireEvent.click(combo); key('Home'); fireEvent.click(combo); expect(formValue()).toBe('berry')
  fireEvent.click(combo); fireEvent.pointerDown(screen.getByRole('button', { name: 'Next' }))
  expect(screen.queryByRole('listbox')).toBeNull()
})
test('disabled controls never open and do not submit; invalid controls keep label/help/error wiring', () => {
  const view = render(<Example disabled />)
  const combo = screen.getByRole<HTMLButtonElement>('combobox'); expect(combo.disabled).toBe(true)
  fireEvent.click(combo); key('End'); expect(screen.queryByRole('listbox')).toBeNull(); expect(formValue()).toBeNull()
  view.rerender(<Example error="Choose another fruit." />)
  expect(combo.getAttribute('aria-invalid')).toBe('true')
  expect(combo.getAttribute('aria-describedby')).toBe('external fruit-help fruit-error')
  expect(screen.getByRole('alert').id).toBe('fruit-error')
})
test('option children and named groups remain compatible and submit the same value', () => {
  const change = vi.fn()
  render(<Select id="legacy" label="Goal" value="" onChange={change}><option value="">Choose</option><optgroup label="On this page"><option value="2">Sign up</option></optgroup></Select>)
  fireEvent.click(screen.getByRole('combobox')); const group = screen.getByRole('group', { name: 'On this page' })
  fireEvent.click(within(group).getByRole('option', { name: 'Sign up' }))
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: '2' }), currentTarget: expect.objectContaining({ value: '2' }) }))
})
test('popup uses the trigger document and top layer, flips above and clamps to a narrow viewport', () => {
  const iframe = document.createElement('iframe'); document.body.append(iframe)
  const doc = iframe.contentDocument!, win = iframe.contentWindow!
  const show = vi.fn(function (this: HTMLElement) { this.style.display = 'block' }), hide = vi.fn(function (this: HTMLElement) { this.style.display = 'none' })
  Object.assign(Object.getPrototypeOf(doc.createElement('div')), { showPopover: show, hidePopover: hide })
  Object.defineProperties(win, { innerWidth: { value: 240 }, innerHeight: { value: 400 } })
  const container = doc.createElement('div'); doc.body.append(container)
  const view = render(<Select id="frame" label="Choice" options={[{ value: 'a', label: 'Alpha' }]} />, { container, baseElement: doc.body })
  const combo = within(doc.body).getByRole('combobox')
  vi.spyOn(combo, 'getBoundingClientRect').mockReturnValue({ left: 180, right: 380, top: 350, bottom: 390, width: 200, height: 40, x: 180, y: 350, toJSON() {} })
  fireEvent.click(combo)
  const popup = within(doc.body).getByRole('listbox')
  expect(popup.ownerDocument).toBe(doc); expect(popup.getAttribute('popover')).toBe('manual'); expect(show).toHaveBeenCalled()
  expect(popup.style.width).toBe('200px'); expect(popup.style.left).toBe('32px'); expect(popup.dataset.placement).toBe('top')
  fireEvent.keyDown(combo, { key: 'Escape' }); expect(hide).toHaveBeenCalled()
  view.unmount(); iframe.remove()
})


test('Space extends an active type-ahead phrase and otherwise commits', () => {
  vi.useFakeTimers()
  const change = vi.fn()
  render(<Select id="place" label="Place" value="nj" onChange={change} options={[{ value: 'nj', label: 'New Jersey' }, { value: 'ny', label: 'New York' }]} />)
  for (const letter of 'New Y') key(letter)
  expect(active()).toBe('New York'); expect(change).not.toHaveBeenCalled()
  vi.advanceTimersByTime(800); key(' ')
  expect(change).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ value: 'ny' }) }))
})


test('mixed JSX option text retains its exact label without inserted commas', () => {
  const name = 'Welcome', status = 'Draft'
  render(<Select id="mixed" label="Test" value="one"><option value="one">{name} · {status}</option><option value="two">Round {2}</option></Select>)
  expect(screen.getByRole('combobox').textContent).toBe('Welcome · Draft')
  fireEvent.click(screen.getByRole('combobox'))
  expect(screen.getByRole('option', { name: 'Welcome · Draft' })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'Round 2' })).toBeTruthy()
})


test('required selections participate in native form validation and focus the visible control', () => {
  const view = render(<form><Select id="required" name="goal" label="Goal" required value="" options={[{ value: '', label: 'Choose' }, { value: 'one', label: 'First' }]} /></form>)
  const combo = screen.getByRole('combobox')
  act(() => { expect(combo.closest('form')!.checkValidity()).toBe(false) })
  expect(document.activeElement).toBe(combo)
  expect(screen.getByRole('alert').textContent).toBe('Choose an option.')
  expect(combo.getAttribute('aria-invalid')).toBe('true')
  expect(combo.getAttribute('aria-describedby')).toBe('required-required-error')
  view.rerender(<form><Select id="required" name="goal" label="Goal" required value="one" options={[{ value: '', label: 'Choose' }, { value: 'one', label: 'First' }]} /></form>)
  expect(combo.closest('form')!.checkValidity()).toBe(true)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(combo.hasAttribute('aria-invalid')).toBe(false)
  expect(new FormData(combo.closest('form')!).get('goal')).toBe('one')
})


test('keyboard focus scrolls the popup without scrolling the surrounding page', () => {
  render(<Example />); key('ArrowDown')
  const menu = screen.getByRole('listbox'), option = screen.getByRole('option', { name: 'Cherry' })
  Object.defineProperty(menu, 'clientHeight', { value: 100 })
  Object.defineProperties(option, { offsetTop: { value: 200 }, offsetHeight: { value: 40 } })
  key('End'); expect(menu.scrollTop).toBe(140)
  key('Home'); expect(menu.scrollTop).toBe(0)
})
test('leaving an open control commits and keeps focus free to move on', () => {
  render(<Example />); const combo = screen.getByRole('combobox')
  key('End'); fireEvent.blur(combo, { relatedTarget: screen.getByRole('button', { name: 'Next' }) })
  expect(formValue()).toBe('cherry'); expect(screen.queryByRole('listbox')).toBeNull()
})


test('committing the current value does not emit a change or submit a redundant save', () => {
  const change = vi.fn()
  render(<Select id="same" label="Choice" value="a" onChange={change} options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]} />)
  key('ArrowDown'); key('Tab')
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('combobox')); fireEvent.click(screen.getByRole('option', { name: 'Alpha' }))
  expect(change).not.toHaveBeenCalled()
})


test('an explicit accessible label names both the control and its popup', () => {
  render(<Select id="label" label="Choice" aria-label="Goal choice" options={[{ value: 'one', label: 'First' }]} />)
  fireEvent.click(screen.getByRole('combobox', { name: 'Goal choice' }))
  expect(screen.getByRole('listbox', { name: 'Goal choice' })).toBeTruthy()
})


test('a short menu stays below when it fits, using its height after opening', () => {
  const iframe = document.createElement('iframe'); document.body.append(iframe)
  const doc = iframe.contentDocument!, win = iframe.contentWindow!
  Object.assign(Object.getPrototypeOf(doc.createElement('div')), {
    showPopover(this: HTMLDivElement) { this.style.display = 'block'; Object.defineProperty(this, 'scrollHeight', { value: 40 }) }, hidePopover() {},
  })
  Object.defineProperty(win, 'innerHeight', { value: 400 })
  const container = doc.createElement('div'); doc.body.append(container)
  const view = render(<Select id="short" label="Choice" options={[{ value: 'a', label: 'Alpha' }]} />, { container, baseElement: doc.body })
  const combo = within(doc.body).getByRole('combobox')
  vi.spyOn(combo, 'getBoundingClientRect').mockReturnValue({ left: 20, right: 220, top: 250, bottom: 290, width: 200, height: 40, x: 20, y: 250, toJSON() {} })
  fireEvent.click(combo)
  expect(within(doc.body).getByRole('listbox').dataset.placement).toBe('bottom')
  view.unmount(); iframe.remove()
})
