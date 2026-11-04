'use client'
import { useId, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import './ui.css'
export interface Tab { id: string; label: string; content: ReactNode; actions?: ReactNode; disabled?: boolean }
export function Tabs({ items, label, value, onChange, tabListRef }: { items: Tab[]; label: string; value?: string; onChange?: (id: string) => void; tabListRef?: Ref<HTMLDivElement> }) {
  const prefix = useId()
  const [local, setLocal] = useState(() => items.find(item => !item.disabled)?.id)
  const requested = value ?? local
  const selected = items.find(item => item.id === requested && !item.disabled)?.id ?? items.find(item => !item.disabled)?.id
  function select(id: string) { setLocal(id); onChange?.(id) }
  return <div className="xp-ui-tabs"><div ref={tabListRef} role="tablist" aria-label={label} className="xp-ui-tablist">
    {items.map(item => <div className="xp-ui-tab-with-actions" key={item.id}><button type="button" role="tab" key={item.id} id={`${prefix}-tab-${item.id}`} aria-controls={`${prefix}-panel-${item.id}`}
      aria-selected={selected === item.id} tabIndex={selected === item.id ? 0 : -1} disabled={item.disabled}
      className="xp-ui-tab" onClick={() => select(item.id)} onKeyDown={event => {
        const enabled = items.filter(tab => !tab.disabled)
        const index = enabled.findIndex(tab => tab.id === item.id)
        const next = event.key === 'ArrowRight' ? enabled[(index + 1) % enabled.length]
          : event.key === 'ArrowLeft' ? enabled[(index - 1 + enabled.length) % enabled.length]
          : event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1) : undefined
        if (!next) return
        event.preventDefault(); select(next.id)
        event.currentTarget.ownerDocument.getElementById(`${prefix}-tab-${next.id}`)?.focus()
      }}>{item.label}</button>{item.actions}</div>)}
  </div>{items.map(item => <div role="tabpanel" id={`${prefix}-panel-${item.id}`} aria-labelledby={`${prefix}-tab-${item.id}`}
    hidden={selected !== item.id} tabIndex={0} key={item.id} className="xp-ui-tabpanel">{item.content}</div>)}</div>
}
