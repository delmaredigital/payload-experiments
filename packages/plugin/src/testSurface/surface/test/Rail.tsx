'use client'
import { useEffect, useRef, useState } from 'react'
import { SECTION_ORDER } from '../contracts.js'
import type { SectionId, TestDocApi } from '../contracts.js'
import { sectionBlocked } from '../readiness/readiness.model.js'
import { readinessParts } from '../readiness/parts.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { jumpToSection } from './jumpToSection.js'

export function Rail({ test }: { test: TestDocApi }) {
  const [active, setActive] = useState<SectionId>('what')
  const ref = useRef<HTMLElement>(null)
  const done = readinessParts.sectionDone(test)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const visible = new Map<SectionId, number>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) visible.set(entry.target.id.replace('section-', '') as SectionId, entry.isIntersecting ? entry.intersectionRatio : 0)
      const best = SECTION_ORDER.filter(id => (visible.get(id) ?? 0) > 0).sort((a, b) => (visible.get(b) ?? 0) - (visible.get(a) ?? 0))[0]
      // Retain the last clicked/visible item when nothing intersects.
      if (best) setActive(best)
    }, { rootMargin: '-10% 0px -60% 0px', threshold: [0, .1, .25, .5, .75, 1] })
    for (const id of SECTION_ORDER) {
      const section = document.getElementById(`section-${id}`)
      if (section) observer.observe(section)
    }
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (window.matchMedia?.('(max-width: 960px)').matches) {
      ref.current?.querySelector<HTMLElement>('[aria-current]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }
  }, [active])
  return <nav ref={ref} className="xp-test-rail" aria-label={C.navigation}><ol className="xp-test-rail-list">
    {SECTION_ORDER.map(id => <li key={id}><a href={`#section-${id}`}
      className={`xp-test-rail-item${sectionBlocked(test, id) ? ' is-blocked' : ''}${id === 'advanced' ? ' xp-test-rail-item--advanced' : ''}${active === id ? ' is-active' : ''}`}
      aria-current={active === id ? 'location' : undefined} onClick={event => {
        event.preventDefault(); setActive(id); jumpToSection(id)
      }}>{id !== 'advanced' ? <><span aria-hidden="true" className={sectionBlocked(test, id) ? 'xp-test-rail-mark xp-test-rail-mark--blocked' : done[id] ? 'xp-test-rail-mark xp-test-rail-mark--done' : 'xp-test-rail-mark'}>{sectionBlocked(test, id) ? '!' : done[id] ? C.completeMark : C.incompleteMark}</span>
      <span className="xp-test-sr-only">{sectionBlocked(test, id) ? 'Needs attention: ' : done[id] ? C.completePrefix : C.incompletePrefix}</span></> : null}{C.sections[id]}</a></li>)}
  </ol></nav>
}
