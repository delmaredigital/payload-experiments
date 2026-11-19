// @vitest-environment jsdom
import '../_helpers/popover.js'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { SelectControl } from '../../src/ui/SelectControl.js'

const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]
afterEach(() => { cleanup(); vi.restoreAllMocks() })

test.each(['popover', 'fallback'])('bare SelectControl positions and distinguishes active and selected options without CSS (%s)', mode => {
  const original = HTMLElement.prototype.showPopover
  if (mode === 'fallback') delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover
  try {
    render(<SelectControl id="bare" aria-label="Choice" options={options} />)
    const combo = screen.getByRole('combobox')
    vi.spyOn(combo, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 100, left: 20, right: 220, top: 100, bottom: 140, width: 200, height: 40, toJSON() {} })
    fireEvent.click(combo)
    const menu = screen.getByRole('listbox')
    expect(menu.style.position).toBe('fixed')
    expect(menu.style.inset).toBe('auto')
    expect(menu.style.right).toBe('auto'); expect(menu.style.bottom).toBe('auto')
    expect(menu.style.margin).toBe('0px')
    expect(menu.style.left).toBe('20px'); expect(menu.style.top).toBe('144px')
    expect(menu.style.overflow).toBe('auto')
    expect(menu.style.background).toBe('var(--xp-surface, Canvas)')
    expect(menu.style.color).toBe('var(--xp-text, CanvasText)')
    fireEvent.keyDown(combo, { key: 'End' })
    const active = screen.getByRole('option', { name: 'Beta' })
    const selected = screen.getByRole('option', { name: 'Alpha' })
    expect(active.style.backgroundColor).toBe('var(--xp-surface-3, Highlight)')
    expect(active.style.color).toBe('var(--xp-text, HighlightText)')
    expect(selected.style.fontWeight).toBe('600')
    expect(selected.getAttribute('aria-selected')).toBe('true')
    expect(active.getAttribute('data-active')).toBe('true')
  } finally { HTMLElement.prototype.showPopover = original }
})

test('fallback observes ancestor theme attributes while open and removes copied tokens on close', async () => {
  const original = HTMLElement.prototype.showPopover
  delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover
  const computed = window.getComputedStyle.bind(window)
  try {
    const { container } = render(<div data-testid="theme"><SelectControl id="theme" options={options} /></div>)
    const host = screen.getByTestId('theme'), combo = screen.getByRole('combobox')
    vi.spyOn(window, 'getComputedStyle').mockImplementation(node => {
      if (node !== combo) return computed(node)
      const sample = document.createElement('div').style
      const dark = host.dataset.theme === 'dark' || host.classList.contains('dark')
      sample.setProperty('--xp-surface', dark ? '#111111' : '#ffffff')
      if (!dark) sample.setProperty('--xp-light-only', 'old')
      sample.direction = dark ? 'rtl' : 'ltr'
      return sample
    })
    fireEvent.click(combo)
    const menu = screen.getByRole('listbox')
    expect(menu.parentElement).toBe(document.body)
    expect(menu.style.getPropertyValue('--xp-surface')).toBe('#ffffff')
    await act(async () => { host.dataset.theme = 'dark' })
    expect(menu.style.getPropertyValue('--xp-surface')).toBe('#111111')
    expect(menu.style.getPropertyValue('--xp-light-only')).toBe('')
    expect(menu.style.direction).toBe('rtl')
    await act(async () => { delete host.dataset.theme })
    expect(menu.style.getPropertyValue('--xp-surface')).toBe('#ffffff')
    await act(async () => { host.classList.add('dark') })
    expect(menu.style.getPropertyValue('--xp-surface')).toBe('#111111')
    fireEvent.keyDown(combo, { key: 'Escape' })
    expect(menu.style.getPropertyValue('--xp-surface')).toBe('')
    expect(menu.style.direction).toBe('')
    // The disconnected observer must not put tokens back on the closed menu.
    await act(async () => { host.classList.remove('dark') })
    expect(menu.style.getPropertyValue('--xp-surface')).toBe('')
    expect(container.querySelector('[role="combobox"]')).toBe(combo)
  } finally { HTMLElement.prototype.showPopover = original }
})

test.each(['popover', 'fallback'])('scrolling the menu or an option does not reposition it (%s)', mode => {
  const original = HTMLElement.prototype.showPopover
  if (mode === 'fallback') delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover
  try {
    render(<SelectControl id="scroll" options={options} />)
    const combo = screen.getByRole('combobox')
    const bounds = vi.spyOn(combo, 'getBoundingClientRect')
    fireEvent.click(combo)
    const menu = screen.getByRole('listbox'); bounds.mockClear()
    fireEvent.scroll(menu); fireEvent.scroll(screen.getByRole('option', { name: 'Beta' }))
    expect(bounds).not.toHaveBeenCalled()
    fireEvent.scroll(window)
    expect(bounds).toHaveBeenCalledOnce()
  } finally { HTMLElement.prototype.showPopover = original }
})
