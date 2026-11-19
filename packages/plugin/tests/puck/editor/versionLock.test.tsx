// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { VersionLock } from '../../../src/puck/editor/VersionBuilder.js'
import { editorCopy as C } from '../../../src/puck/editor/copy.js'

afterEach(() => { cleanup(); vi.useRealTimers() })

test.each([C.lockedGeneric, C.readOnlyVersions, ...Object.values(C.locked)])('lock notice explains repeated attempts: %s', message => {
  vi.useFakeTimers()
  const activate = vi.fn()
  const { rerender } = render(<VersionLock message={message}>{id => <button aria-disabled="true" aria-describedby={id} onClick={activate}>{C.split}</button>}</VersionLock>)
  const button = screen.getByRole('button')
  const notice = document.getElementById(button.getAttribute('aria-describedby')!)!
  const scroll = vi.fn()
  notice.scrollIntoView = scroll
  act(() => button.focus())
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(button)
  const firstAnnouncement = screen.getByRole('alert')
  fireEvent.keyDown(button, { key: ' ' })
  expect(screen.getByRole('alert')).toBe(firstAnnouncement)
  expect(screen.getByRole('alert').textContent).toBe(message)
  expect(activate).not.toHaveBeenCalled()
  expect(scroll).toHaveBeenCalledTimes(1)
  act(() => { vi.advanceTimersByTime(1999) })
  fireEvent.keyDown(button, { key: 'a' })
  expect(scroll).toHaveBeenCalledTimes(1)
  act(() => { vi.advanceTimersByTime(1) })
  expect(notice.getAttribute('data-attention')).toBe('false')
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.keyDown(button, { key: 'b' })
  expect(scroll).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('alert').textContent).toBe(message)
  expect(document.activeElement).toBe(button)
  rerender(<VersionLock>{id => <button aria-describedby={id} onClick={activate}>{C.split}</button>}</VersionLock>)
  expect(screen.queryByText(message)).toBeNull()
  fireEvent.click(screen.getByRole('button'))
  expect(activate).toHaveBeenCalledOnce()
})

test('read-only values still permit navigation, selection and copying', () => {
  render(<VersionLock message={C.locked.running}>{id => <input aria-label={C.name} aria-disabled="true" aria-describedby={id} value="Original" readOnly />}</VersionLock>)
  const input = screen.getByRole('textbox')
  for (const key of ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape']) expect(fireEvent.keyDown(input, { key })).toBe(true)
  for (const key of ['a', 'c']) expect(fireEvent.keyDown(input, { key, ctrlKey: true })).toBe(true)
  expect(fireEvent.keyDown(input, { key: 'c', metaKey: true })).toBe(true)
  expect(screen.queryByRole('alert')).toBeNull()
})


test('stepping locked Traffic explains the lock without changing its value', () => {
  render(<VersionLock message={C.locked.running}>{id => <input type="number" aria-label={C.traffic} aria-disabled="true" aria-describedby={id} value={50} readOnly />}</VersionLock>)
  const input = screen.getByRole<HTMLInputElement>('spinbutton')
  expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(false)
  expect(fireEvent.keyDown(input, { key: 'ArrowDown' })).toBe(false)
  expect(screen.getByRole('alert').textContent).toBe(C.locked.running)
  expect(input.value).toBe('50')
})


test('lock attention clears with reduced motion and cleans up on unmount', () => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const view = render(<VersionLock message={C.locked.running}>{id => <button aria-disabled="true" aria-describedby={id}>{C.split}</button>}</VersionLock>)
  fireEvent.click(screen.getByRole('button'))
  expect(screen.getByRole('alert')).toBeTruthy()
  act(() => { vi.advanceTimersByTime(2000) })
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button'))
  expect(vi.getTimerCount()).toBe(1)
  view.unmount()
  expect(vi.getTimerCount()).toBe(0)
  vi.unstubAllGlobals()
})
