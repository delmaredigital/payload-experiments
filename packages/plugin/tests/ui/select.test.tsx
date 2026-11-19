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

test.each(['outside', 'blur', 'Tab'])('pointer hover never selects on %s', leaving => {
  const change = vi.fn()
  render(<><Select id="role" name="role" label="Other goal" defaultValue="watch" onChange={change} options={[
    { value: 'watch', label: 'Watch' }, { value: 'guardrail', label: 'Must not get worse' },
  ]} /><button>Elsewhere</button></>)
  const combo = screen.getByRole('combobox'); combo.focus(); fireEvent.click(combo)
  fireEvent.pointerMove(screen.getByRole('option', { name: 'Must not get worse' }))
  if (leaving === 'outside') fireEvent.pointerDown(screen.getByText('Elsewhere'))
  else if (leaving === 'blur') fireEvent.blur(combo)
  else fireEvent.keyDown(combo, { key: 'Tab' })
  expect(screen.queryByRole('listbox')).toBeNull(); expect(change).not.toHaveBeenCalled()
  expect(combo.textContent).toBe('Watch')
})
test('keyboard exploration still commits on an outside click', () => {
  render(<Example />); key('End')
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Next' }))
  expect(formValue()).toBe('cherry')
})
test('label clicks focus the control without opening its menu', () => {
  render(<Example />)
  fireEvent.click(screen.getByText('Fruit', { selector: 'label' }))
  expect(document.activeElement).toBe(screen.getByRole('combobox'))
  expect(screen.queryByRole('listbox')).toBeNull()
})
test('aria-controls is stable while closed, and a group is named by its visible label once', () => {
  render(<Select id="groups" label="Choice" options={[{ value: 'a', label: 'Alpha', group: 'Letters' }]} />)
  const combo = screen.getByRole('combobox')
  expect(combo.getAttribute('aria-controls')).toBe('groups-listbox')
  const list = document.getElementById(combo.getAttribute('aria-controls')!)!
  expect(list).toBeTruthy(); expect(list.hidden).toBe(true)
  fireEvent.click(combo)
  const group = screen.getByRole('group', { name: 'Letters' })
  expect(group.hasAttribute('aria-label')).toBe(false)
  expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toBe('Letters')
})
test('uncontrolled value follows options that arrive later and retains a chosen value', () => {
  const view = render(<form><Select id="late" name="late" label="Late" options={[]} /></form>)
  const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]
  view.rerender(<form><Select id="late" name="late" label="Late" options={options} /></form>)
  const combo = screen.getByRole('combobox')
  expect(combo.textContent).toBe('Alpha'); expect(new FormData(combo.closest('form')!).get('late')).toBe('a')
  fireEvent.click(combo); fireEvent.click(screen.getByRole('option', { name: 'Beta' }))
  view.rerender(<form><Select id="late" name="late" label="Late" options={[...options]} /></form>)
  expect(combo.textContent).toBe('Beta')
})
test('a disabled combobox makes the interaction helper fail loudly', async () => {
  const { changeField } = await import('../_helpers/select.js')
  render(<Example disabled />)
  expect(() => changeField(screen.getByRole('combobox'), { target: { value: 'banana' } })).toThrow(/disabled/i)
})
test.each(['popover', 'fallback'])('Escape closes only the menu inside a modal (%s)', async mode => {
  const { Dialog } = await import('../../src/ui/Dialog.js')
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  const original = HTMLElement.prototype.showPopover
  if (mode === 'fallback') delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover
  const close = vi.fn()
  render(<Dialog open title="Configure" onClose={close}><div style={{ transform: 'translateX(10px)' }}><Example /></div></Dialog>)
  const combo = screen.getByRole('combobox'); fireEvent.click(combo)
  const menu = screen.getByRole('listbox')
  if (mode === 'fallback') expect(menu.parentElement).toBe(screen.getByRole('dialog'))
  key('Escape')
  expect(screen.queryByRole('listbox')).toBeNull(); expect(close).not.toHaveBeenCalled()
  key('Escape'); expect(close).toHaveBeenCalledTimes(1)
  HTMLElement.prototype.showPopover = original
  vi.restoreAllMocks()
})
test('without popovers the popup escapes transformed ancestors into its document body', () => {
  const original = HTMLElement.prototype.showPopover
  // Feature absence, rather than an API stub that still counts as support.
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover
  try {
    render(<div style={{ transform: 'translateX(20px)' }}><Example /></div>)
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox').parentElement).toBe(document.body)
    fireEvent.click(screen.getByRole('option', { name: 'Berry' }))
    expect(formValue()).toBe('berry')
  } finally { HTMLElement.prototype.showPopover = original }
})
test('scroll closes the menu when its trigger leaves the drawer body', () => {
  render(<div data-testid="scroll" style={{ overflow: 'auto' }}><Example /></div>)
  const scroller = screen.getByTestId('scroll'), combo = screen.getByRole('combobox')
  const rect = (top: number, bottom: number) => ({ x: 20, y: top, left: 20, right: 220, top, bottom, width: 200, height: bottom - top, toJSON() {} })
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(100, 300))
  const bounds = vi.spyOn(combo, 'getBoundingClientRect').mockReturnValue(rect(120, 160))
  fireEvent.click(combo); expect(screen.getByRole('listbox')).toBeTruthy()
  bounds.mockReturnValue(rect(60, 100)); fireEvent.scroll(scroller)
  expect(screen.queryByRole('listbox')).toBeNull(); expect(formValue()).toBe('apple')
})
test.each(['ltr', 'rtl'])('popup widens, anchors logically, and uses visual viewport coordinates (%s)', direction => {
  render(<div dir={direction}><Example /></div>)
  const combo = screen.getByRole('combobox')
  vi.spyOn(combo, 'getBoundingClientRect').mockReturnValue({ x: direction === 'rtl' ? 320 : 250, y: 400, left: direction === 'rtl' ? 320 : 250, right: direction === 'rtl' ? 380 : 310, top: 400, bottom: 440, width: 60, height: 40, toJSON() {} })
  vi.spyOn(window, 'getComputedStyle').mockImplementation(node => ({ direction, overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }) as CSSStyleDeclaration)
  const viewport = new EventTarget()
  Object.assign(viewport, { offsetLeft: 100, offsetTop: 100, width: 400, height: 400 })
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  const intrinsic = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('role') === 'listbox' ? 240 : 0 })
  try {
    fireEvent.click(combo)
    const menu = screen.getByRole('listbox')
    expect(menu.style.width).toBe('240px')
    expect(menu.style.left).toBe(direction === 'ltr' ? '250px' : '140px')
    expect(menu.dataset.placement).toBe('top'); expect(menu.style.top).toBe('116px'); expect(menu.style.bottom).toBe('auto')
  } finally { intrinsic.mockRestore(); vi.restoreAllMocks(); Reflect.deleteProperty(window, 'visualViewport') }
})

test.each([['ltr', 430, 490, '250px'], ['rtl', 150, 210, '150px']] as const)('popup flips to the logical end near the %s viewport edge', (direction, left, right, expected) => {
  render(<Example />)
  const combo = screen.getByRole('combobox')
  vi.spyOn(combo, 'getBoundingClientRect').mockReturnValue({ x: left, y: 200, left, right, top: 200, bottom: 240, width: 60, height: 40, toJSON() {} })
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction, overflow: 'visible' } as CSSStyleDeclaration)
  const viewport = new EventTarget()
  Object.assign(viewport, { offsetLeft: 100, offsetTop: 100, width: 400, height: 400 })
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(240)
  try { fireEvent.click(combo); expect(screen.getByRole('listbox').style.left).toBe(expected) }
  finally { vi.restoreAllMocks(); Reflect.deleteProperty(window, 'visualViewport') }
})

test('native dialog cancel is consumed while the menu is open', async () => {
  const { Dialog } = await import('../../src/ui/Dialog.js')
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  const close = vi.fn()
  render(<Dialog open title="Configure" onClose={close}><Example /></Dialog>)
  fireEvent.click(screen.getByRole('combobox'))
  const cancel = new Event('cancel', { cancelable: true })
  fireEvent(screen.getByRole('dialog'), cancel)
  expect(cancel.defaultPrevented).toBe(true)
  expect(screen.queryByRole('listbox')).toBeNull(); expect(close).not.toHaveBeenCalled()
})

test('intrinsic popup width includes its borders so the longest option need not wrap', () => {
  render(<Example />)
  const combo = screen.getByRole('combobox')
  vi.spyOn(combo, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 200, left: 20, right: 80, top: 200, bottom: 240, width: 60, height: 40, toJSON() {} })
  const computed = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(node => node.getAttribute('role') === 'listbox'
    ? { borderLeftWidth: '1px', borderRightWidth: '1px' } as CSSStyleDeclaration : computed(node))
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(240)
  try { fireEvent.click(combo); expect(screen.getByRole('listbox').style.width).toBe('242px') }
  finally { vi.restoreAllMocks() }
})

test('fallback portal keeps the selected option in view after the listbox remounts', () => {
  const original = HTMLElement.prototype.showPopover
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) { return this.textContent === 'Last' ? 200 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40)
  try {
    render(<Select id="fallback-scroll" label="Choice" value="last" options={[{ value: 'first', label: 'First' }, { value: 'last', label: 'Last' }]} />)
    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox').parentElement).toBe(document.body)
    expect(screen.getByRole('listbox').scrollTop).toBe(140)
  } finally { vi.restoreAllMocks(); HTMLElement.prototype.showPopover = original }
})
