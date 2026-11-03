// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { Button } from '../../src/ui/Button.js'
import { TextInput, NumberInput, SearchInput, Select, Toggle } from '../../src/ui/Inputs.js'
import { Tabs } from '../../src/ui/Tabs.js'
import { Dialog } from '../../src/ui/Dialog.js'
import { StatusChip, statusLabels } from '../../src/ui/Feedback.js'
afterEach(cleanup)
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
test('button links, disabled and busy prevent actions', () => {
  const clicked = vi.fn()
  render(<><Button href="/tests">Tests</Button><Button href="/new" disabled onClick={clicked}>Disabled link</Button>
    <Button busy onClick={clicked}>Saving</Button><Button disabled onClick={clicked}>Disabled</Button></>)
  expect(screen.getByRole('link', { name: 'Tests' }).getAttribute('href')).toBe('/tests')
  const disabled = screen.getByRole('link', { name: 'Disabled link' })
  expect(disabled.hasAttribute('href')).toBe(false)
  expect(disabled.getAttribute('aria-disabled')).toBe('true')
  expect(disabled.tabIndex).toBe(-1)
  fireEvent.click(disabled); fireEvent.click(screen.getByText('Saving')); fireEvent.click(screen.getByText('Disabled'))
  expect(clicked).not.toHaveBeenCalled()
  expect(screen.getByText('Saving').getAttribute('aria-busy')).toBe('true')
  expect((screen.getByText('Saving') as HTMLButtonElement).disabled).toBe(true)
})
test.each([TextInput, NumberInput, SearchInput, Select, Toggle])('%s associates label, help and announced error', Component => {
  render(<Component id="field" label="Name" help="Helpful sentence." error="Please check this." aria-describedby="external" />)
  const control = screen.getByLabelText('Name')
  expect(control.getAttribute('aria-invalid')).toBe('true')
  expect(control.getAttribute('aria-describedby')).toBe('external field-help field-error')
  expect(screen.getByRole('alert').id).toBe('field-error')
  expect(screen.getByText('Helpful sentence.').id).toBe('field-help')
})
test('toggle supports Space and disabled switches remain unchanged', () => {
  const changed = vi.fn()
  function Example() { const [checked, set] = useState(false); return <Toggle id="toggle" label="Include staff" checked={checked} onChange={e => { set(e.target.checked); changed() }} /> }
  const { rerender } = render(<Example />)
  const toggle = screen.getByRole('switch') as HTMLInputElement
  toggle.focus(); fireEvent.keyDown(toggle, { key: ' ' })
  expect(toggle.checked).toBe(true)
  fireEvent.keyDown(toggle, { key: ' ' })
  expect(toggle.checked).toBe(false)
  expect(changed).toHaveBeenCalledTimes(2)
  rerender(<Toggle id="disabled" label="Disabled" disabled checked={false} onChange={changed} />)
  fireEvent.keyDown(screen.getByRole('switch'), { key: ' ' })
  expect(changed).toHaveBeenCalledTimes(2)
})
test('tabs automatically activate, wrap, skip disabled and associate panels', () => {
  render(<Tabs label="Versions" items={[
    { id: 'a', label: 'Original', content: 'Original content' }, { id: 'b', label: 'Unavailable', content: '', disabled: true },
    { id: 'c', label: 'Variant A', content: 'Variant content' },
  ]} />)
  const [first, , last] = screen.getAllByRole('tab')
  first!.focus(); fireEvent.keyDown(first!, { key: 'ArrowRight' })
  expect(document.activeElement).toBe(last)
  expect(last!.getAttribute('aria-selected')).toBe('true')
  const panel = screen.getByRole('tabpanel')
  expect(panel.id).toBe(last!.getAttribute('aria-controls'))
  expect(panel.getAttribute('aria-labelledby')).toBe(last!.id)
  fireEvent.keyDown(last!, { key: 'ArrowRight' }); expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first!, { key: 'ArrowLeft' }); expect(document.activeElement).toBe(last)
  fireEvent.keyDown(last!, { key: 'Home' }); expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first!, { key: 'End' }); expect(document.activeElement).toBe(last)
})
test('dialog traps focus, closes on Escape, and restores its trigger', () => {
  const close = vi.fn()
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  const { rerender } = render(<Dialog open title="Stop the test?" onClose={close}><input type="hidden" /><button style={{ display: 'none' }}>CSS hidden</button><button>Cancel</button><button>Stop</button><input type="hidden" /><button tabIndex={-1}>Excluded</button></Dialog>)
  const dialog = screen.getByRole('dialog', { name: 'Stop the test?' })
  const first = within(dialog).getByRole('button', { name: 'Cancel' }), last = within(dialog).getByRole('button', { name: 'Stop' })
  expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first!, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last)
  fireEvent.keyDown(last!, { key: 'Tab' }); expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first!, { key: 'Escape' }); expect(close).toHaveBeenCalledOnce()
  rerender(<Dialog open={false} title="Stop the test?" onClose={close}>Closed</Dialog>)
  expect(document.activeElement).toBe(trigger)
  expect(dialog.hasAttribute('open')).toBe(false)
  trigger.remove()
})
test('dialog uses its iframe document for focus', () => {
  const iframe = document.createElement('iframe'); document.body.append(iframe)
  const doc = iframe.contentDocument!
  // jsdom iframe constructors have their own prototypes.
  const prototype = Object.getPrototypeOf(doc.createElement('dialog')) as HTMLDialogElement
  prototype.showModal = function () { this.setAttribute('open', '') }
  prototype.close = function () { this.removeAttribute('open') }
  const trigger = doc.createElement('button'); doc.body.append(trigger); trigger.focus()
  const container = doc.createElement('div'); doc.body.append(container)
  const { unmount } = render(<Dialog open title="Iframe dialog" onClose={() => {}}><button>First</button><button>Last</button></Dialog>, { container, baseElement: doc.body })
  const [first, last] = within(doc.body).getAllByRole('button').slice(1)
  expect(doc.activeElement).toBe(first)
  fireEvent.keyDown(first!, { key: 'Tab', shiftKey: true }); expect(doc.activeElement).toBe(last)
  unmount(); expect(doc.activeElement).toBe(trigger)
  iframe.remove()
})
test.each(Object.entries(statusLabels))('status %s has label %s', (status, label) => {
  render(<StatusChip status={status as keyof typeof statusLabels} />)
  expect(screen.getByText(label).className).toContain(`xp-ui-status--${status}`)
})


test('tabs retain a keyboard entry when the selected item is removed', () => {
  const { rerender } = render(<Tabs label="Versions" items={[{ id: 'a', label: 'Original', content: 'First' }]} />)
  rerender(<Tabs label="Versions" items={[{ id: 'b', label: 'Variant', content: 'Second' }]} />)
  expect(screen.getByRole('tab').tabIndex).toBe(0)
  expect(screen.getByRole('tabpanel').textContent).toBe('Second')
})

test.each(['keydown-first', 'cancel-first'])('dialog requests one close per opening with %s', order => {
  const close = vi.fn()
  const { rerender } = render(<Dialog open title="Close once" onClose={close}><button>Cancel</button></Dialog>)
  const dialog = screen.getByRole('dialog')
  const escape = () => fireEvent.keyDown(dialog, { key: 'Escape' })
  const cancel = () => fireEvent(dialog, new Event('cancel', { cancelable: true }))
  if (order === 'keydown-first') { escape(); cancel() } else { cancel(); escape() }
  expect(close).toHaveBeenCalledTimes(1)
  rerender(<Dialog open={false} title="Close once" onClose={close}>Closed</Dialog>)
  rerender(<Dialog open title="Close once" onClose={close}><button>Cancel</button></Dialog>)
  escape(); cancel()
  expect(close).toHaveBeenCalledTimes(2)
})
