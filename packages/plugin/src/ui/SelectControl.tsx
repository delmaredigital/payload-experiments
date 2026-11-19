'use client'
import { Children, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { INPUT_COPY } from '../testSurface/copy/common.js'

// Style-free client leaf for the server-safe /puck entry. Inputs.tsx and the
// admin/editor stylesheets load ui.css for their respective rendering contexts.

export interface SelectOption { value: string; label: string; disabled?: boolean; group?: string }
export interface SelectChange { target: { value: string; name?: string }; currentTarget: { value: string; name?: string } }
export interface SelectControlProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value' | 'defaultValue' | 'children'> {
  id: string; value?: string | number | readonly string[]; defaultValue?: string | number | readonly string[]
  options?: readonly SelectOption[]; children?: ReactNode; onChange?: (event: SelectChange) => void
  name?: string; form?: string; required?: boolean
}
function optionText(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<{ children?: ReactNode }>(child) ? optionText(child.props.children) : String(child)).join('')
}
/** Keep existing option/optgroup callers while giving new callers a plain options API. */
function childOptions(children: ReactNode, group?: string, disabled = false): SelectOption[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; label?: string; disabled?: boolean }>(child)) return []
    const p = child.props
    if (child.type === 'option') return [{ value: String(p.value ?? optionText(p.children)), label: p.label ?? optionText(p.children), disabled: disabled || p.disabled, group }]
    return childOptions(p.children, child.type === 'optgroup' ? p.label : group, disabled || Boolean(p.disabled))
  })
}

/** Select-only combobox: DOM focus stays on the button while active-descendant
 * focus explores the list. The manual popover lives in the trigger's document
 * and inherits its theme; the browser's top layer escapes scroll/iframe drawers.
 */
export function SelectControl({ id, value, defaultValue, options: supplied, children, onChange, name, form, required, disabled, className = '', onKeyDown, onBlur, ...props }: SelectControlProps) {
  const options = useMemo(() => supplied ?? childOptions(children), [supplied, children])
  // Derive the native-select default until a value has actually been chosen;
  // asynchronously loaded options then supply the first value too.
  const [local, setLocal] = useState<string | undefined>(defaultValue === undefined ? undefined : String(defaultValue))
  const selected = String(value ?? local ?? options[0]?.value ?? '')
  const [open, setOpen] = useState(false)
  const [requiredInvalid, setRequiredInvalid] = useState(false)
  const missingRequired = requiredInvalid && required && !selected
  const [active, setActive] = useState(-1)
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const keyboardActive = useRef(false)
  const typed = useRef({ text: '', at: 0 })
  const enabled = options.flatMap((option, index) => option.disabled ? [] : [index])
  const groups: Array<{ label?: string; start: number; options: SelectOption[] }> = []
  options.forEach((option, index) => {
    const last = groups.at(-1)
    if (last && last.label === option.group) last.options.push(option)
    else groups.push({ label: option.group, start: index, options: [option] })
  })
  const selectedIndex = options.findIndex(option => option.value === selected)
  const current = enabled.includes(active) ? active : enabled.includes(selectedIndex) ? selectedIndex : enabled[0] ?? -1
  const listId = `${id}-listbox`
  const optionId = (index: number) => `${id}-option-${index}`
  function begin(index = enabled.includes(selectedIndex) ? selectedIndex : enabled[0] ?? -1, keyboard = false) {
    if (disabled) return
    keyboardActive.current = keyboard
    typed.current = { text: '', at: 0 }; setActive(index); setOpen(true)
  }
  function commit(index = current) {
    if (disabled || !options[index] || options[index].disabled) { setOpen(false); return }
    const next = options[index].value
    setLocal(next)
    if (next) setRequiredInvalid(false)
    const target = { value: next, name }
    if (next !== selected) onChange?.({ target, currentTarget: target })
    setOpen(false)
  }
  function leave() {
    if (keyboardActive.current) commit()
    else setOpen(false)
  }
  useLayoutEffect(() => {
    const node = trigger.current, menu = popup.current
    if (!open || !node || !menu || disabled) return
    const win = node.ownerDocument.defaultView
    if (!win) return
    const topLayer = typeof menu.showPopover === 'function'
    // Without popovers, escape transformed/scrolling content through a portal.
    // Keep it in the nearest native modal: a body portal would be inert and
    // painted below that modal. Our Dialog/Drawer root has no transform.
    const host = topLayer ? null : node.closest<HTMLDialogElement>('dialog[open]') ?? node.ownerDocument.body
    if (host !== portalHost) { setPortalHost(host); return }
    const style = win.getComputedStyle(node)
    if (host) {
      // Portals lose inherited theme tokens. Snapshot the trigger's computed
      // tokens rather than inheriting the outer document's potentially light theme.
      for (const property of Array.from(style)) if (property.startsWith('--xp-')) menu.style.setProperty(property, style.getPropertyValue(property))
      menu.style.direction = style.direction
      menu.style.display = 'block'
    }
    const position = () => {
      const rect = node.getBoundingClientRect()
      const viewport = win.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? win.innerWidth, height = viewport?.height ?? win.innerHeight
      let clipTop = top, clipBottom = top + height, clipLeft = left, clipRight = left + width
      for (let parent = node.parentElement; parent && parent !== node.ownerDocument.body; parent = parent.parentElement) {
        const css = win.getComputedStyle(parent)
        const bounds = parent.getBoundingClientRect()
        if (/(auto|scroll|hidden|clip)/.test(`${css.overflow} ${css.overflowY}`)) {
          clipTop = Math.max(clipTop, bounds.top); clipBottom = Math.min(clipBottom, bounds.bottom)
        }
        if (/(auto|scroll|hidden|clip)/.test(`${css.overflow} ${css.overflowX}`)) {
          clipLeft = Math.max(clipLeft, bounds.left); clipRight = Math.min(clipRight, bounds.right)
        }
      }
      if ((rect.width || rect.height) && (rect.bottom <= clipTop || rect.top >= clipBottom || rect.right <= clipLeft || rect.left >= clipRight)) {
        setOpen(false); return
      }
      const minLeft = left + 8, maxRight = left + width - 8
      const limit = Math.max(0, maxRight - minLeft)
      menu.style.width = 'max-content'; menu.style.maxWidth = `${limit}px`
      const menuStyle = win.getComputedStyle(menu)
      const borders = (parseFloat(menuStyle.borderLeftWidth) || 0) + (parseFloat(menuStyle.borderRightWidth) || 0)
      const menuWidth = Math.min(Math.max(rect.width, menu.scrollWidth + borders), limit)
      const below = Math.max(0, top + height - rect.bottom - 8)
      const above = Math.max(0, rect.top - top - 8)
      const menuHeight = Math.min(menu.scrollHeight || 280, 280)
      const flip = below < menuHeight && above > below
      const rtl = style.direction === 'rtl'
      let x = rtl ? rect.right - menuWidth : rect.left
      // Prefer logical start, then logical end, then clamp to the viewport.
      if (x < minLeft || x + menuWidth > maxRight) x = rtl ? rect.left : rect.right - menuWidth
      x = Math.max(minLeft, Math.min(x, maxRight - menuWidth))
      const available = flip ? above : below
      Object.assign(menu.style, { width: `${menuWidth}px`, left: `${x}px`,
        top: `${flip ? rect.top - Math.min(menuHeight, available) - 4 : rect.bottom + 4}px`, bottom: 'auto',
        maxHeight: `${Math.min(280, available)}px` })
      menu.dataset.placement = flip ? 'top' : 'bottom'
    }
    if (topLayer) menu.showPopover()
    position()
    const Resize = (win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
    const observer = Resize ? new Resize(position) : undefined
    observer?.observe(node)
    win.addEventListener('resize', position); win.addEventListener('scroll', position, true)
    win.visualViewport?.addEventListener('resize', position); win.visualViewport?.addEventListener('scroll', position)
    return () => {
      if (topLayer) menu.hidePopover?.(); observer?.disconnect()
      win.removeEventListener('resize', position); win.removeEventListener('scroll', position, true)
      win.visualViewport?.removeEventListener('resize', position); win.visualViewport?.removeEventListener('scroll', position)
    }
  }, [open, disabled, options, portalHost])
  useLayoutEffect(() => {
    const menu = popup.current
    const option = menu?.querySelector<HTMLElement>(`[data-index="${current}"]`)
    if (!open || !menu || !option) return
    // Scroll only the popup, without moving the drawer or the page behind it.
    const top = option.offsetTop, bottom = top + option.offsetHeight
    if (top < menu.scrollTop) menu.scrollTop = top
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight
  }, [open, current, portalHost])
  useEffect(() => {
    if (!open) return
    const doc = trigger.current?.ownerDocument
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!trigger.current?.contains(target) && !popup.current?.contains(target)) leave()
    }
    doc?.addEventListener('pointerdown', outside, true)
    return () => doc?.removeEventListener('pointerdown', outside, true)
  })
  useEffect(() => {
    const node = trigger.current
    if (!node) return
    // A button is labelable: suppress label activation's synthetic click, while
    // retaining native label association and the expected focus behavior.
    const labelClick = (event: MouseEvent) => {
      const target = event.target as Element | null
      const label = target?.closest?.('label')
      if (label?.control === node && !node.contains(target)) { event.preventDefault(); node.focus() }
    }
    node.ownerDocument.addEventListener('click', labelClick, true)
    return () => node.ownerDocument.removeEventListener('click', labelClick, true)
  }, [id])
  useEffect(() => {
    if (!open) return
    const dialog = trigger.current?.closest('dialog')
    // Native cancel is also guarded for browser-generated dialog dismissal.
    const cancel = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false) }
    dialog?.addEventListener('cancel', cancel, true)
    return () => dialog?.removeEventListener('cancel', cancel, true)
  }, [open])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  function typeAhead(key: string) {
    keyboardActive.current = true
    const now = Date.now()
    const text = !open || now - typed.current.at > 700 ? key : typed.current.text + key
    typed.current = { text, at: now }
    const repeated = [...text].every(letter => letter === text[0])
    const search = (repeated ? key : text).toLocaleLowerCase('en-US')
    const start = repeated ? (open ? current : selectedIndex) + 1 : Math.max(0, current)
    const order = [...enabled.filter(index => index >= start), ...enabled.filter(index => index < start)]
    const match = order.find(index => options[index]!.label.toLocaleLowerCase('en-US').startsWith(search))
    setOpen(true); if (match !== undefined) setActive(match)
  }
  const menu = <div ref={popup} hidden={!open || disabled} style={!open || disabled ? { display: 'none' } : undefined} id={listId} role="listbox" aria-label={props['aria-label']} aria-labelledby={props['aria-labelledby'] ?? (props['aria-label'] ? undefined : `${id}-label`)}
    popover={portalHost ? undefined : 'manual'} className="xp-ui-combobox-popup" onPointerDown={event => { event.preventDefault(); event.stopPropagation() }}>
    {groups.map(group => <div key={group.start} role={group.label ? 'group' : undefined} aria-labelledby={group.label ? `${id}-group-${group.start}` : undefined}>
      {group.label ? <div id={`${id}-group-${group.start}`} className="xp-ui-combobox-group">{group.label}</div> : null}
      {group.options.map((option, offset) => {
        const index = group.start + offset
        return <div key={option.value} role="option" id={optionId(index)} data-index={index} data-value={option.value}
          aria-selected={current === index} aria-disabled={option.disabled || undefined} className="xp-ui-combobox-option"
          onPointerMove={() => { if (!option.disabled) { keyboardActive.current = false; setActive(index) } }}
          onClick={() => { if (!option.disabled) { commit(index); trigger.current?.focus() } }}>{option.label}</div>
      })}
    </div>)}
  </div>
  return <div className="xp-ui-combobox-wrap">
    <button {...props} id={id} ref={trigger} value={selected} type="button" role="combobox" disabled={disabled} aria-expanded={open && !disabled}
      aria-haspopup="listbox" aria-controls={listId} aria-activedescendant={open && current >= 0 ? optionId(current) : undefined}
      aria-required={required || undefined} aria-invalid={props['aria-invalid'] || missingRequired || undefined}
      aria-describedby={[props['aria-describedby'], missingRequired ? `${id}-required-error` : undefined].filter(Boolean).join(' ') || undefined} className={`xp-ui-input xp-ui-combobox ${className}`}
      onClick={() => open ? setOpen(false) : begin()}
      onBlur={event => { if (open) leave(); onBlur?.(event) }}
      onKeyDown={event => {
        onKeyDown?.(event)
        if (event.defaultPrevented || disabled || event.nativeEvent.isComposing) return
        const key = event.key
        if (key === 'Tab') { if (open) leave(); return }
        if (key === 'Escape') { if (open) { event.preventDefault(); event.stopPropagation(); event.nativeEvent.stopImmediatePropagation(); setOpen(false) }; return }
        if (open && key === ' ' && typed.current.text && Date.now() - typed.current.at <= 700) { event.preventDefault(); typeAhead(key); return }
        if (key === 'Enter' || key === ' ') { event.preventDefault(); open ? commit() : begin(undefined, true); return }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'].includes(key)) {
          event.preventDefault()
          keyboardActive.current = true
          if (open && event.altKey && key === 'ArrowUp') { commit(); return }
          if (key === 'Home' || (!open && key === 'ArrowUp')) begin(enabled[0] ?? -1, true)
          else if (key === 'End') begin(enabled.at(-1) ?? -1, true)
          else if (!open) begin(undefined, true)
          else {
            const offset = key === 'ArrowUp' ? -1 : key === 'PageUp' ? -10 : key === 'PageDown' ? 10 : 1
            setActive(enabled[Math.max(0, Math.min(enabled.length - 1, enabled.indexOf(current) + offset))] ?? -1)
          }
          return
        }
        if (key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); typeAhead(key) }
      }}><span>{options[selectedIndex]?.label ?? ''}</span><span className="xp-ui-combobox-chevron" aria-hidden="true" /></button>
    <input type="hidden" name={name} form={form} value={selected} disabled={disabled} />
    {required ? <input className="xp-ui-combobox-validation" aria-hidden="true" tabIndex={-1} value={selected} required disabled={disabled}
      form={form} onChange={() => {}} onInvalid={event => { event.preventDefault(); setRequiredInvalid(true); trigger.current?.focus() }} /> : null}
    {missingRequired ? <p className="xp-ui-error" id={`${id}-required-error`} role="alert">{INPUT_COPY.selectRequired}</p> : null}
    {portalHost ? createPortal(menu, portalHost) : menu}
  </div>
}
