import type { SectionId } from '../contracts.js'

/** Open disclosures before scrolling, then give keyboard users a meaningful landing. */
export function jumpToSection(section: SectionId, arm?: string) {
  const target = document.getElementById(`section-${section}`)
  if (target instanceof HTMLDetailsElement) target.open = true
  const row = arm ? document.getElementById(`xp-version-${arm}`) : null
  ;(row ?? target)?.scrollIntoView?.({ block: 'start' })
  ;(row ?? document.getElementById(`title-${section}`))?.focus({ preventScroll: true })
}
