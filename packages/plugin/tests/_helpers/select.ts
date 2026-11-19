import { act, fireEvent, within } from '@testing-library/react'

/** Drive the shared dropdown through its rendered menu, like a pointer user. */
export function openSelect(control: HTMLElement) {
  if (control.getAttribute('aria-expanded') !== 'true') {
    fireEvent.pointerDown(control)
    act(() => control.focus())
    fireEvent.click(control)
  }
  const list = control.ownerDocument.getElementById(control.getAttribute('aria-controls')!)
  if (!list) throw new Error('The dropdown did not open')
  return within(list)
}
export function changeField(control: HTMLElement, event: { target: { value: unknown } }, { allowMissing = false } = {}) {
  if (control.tagName !== 'BUTTON' || control.getAttribute('role') !== 'combobox') return fireEvent.change(control, event)
  if ((control as HTMLButtonElement).disabled) throw new Error('Cannot change a disabled combobox')
  openSelect(control)
  const popup = control.ownerDocument.getElementById(control.getAttribute('aria-controls')!)!
  const option = [...popup.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.dataset.value === String(event.target.value))
  if (option) fireEvent.click(option)
  else {
    fireEvent.keyDown(control, { key: 'Escape' })
    if (!allowMissing) throw new Error(`Dropdown option ${String(event.target.value)} is missing`)
  }
}
