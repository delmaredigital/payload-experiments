import type { SectionId } from '../contracts.js'

/** Open disclosures before scrolling, then give keyboard users a meaningful landing. */
export function jumpToSection(section: SectionId) {
  const target = document.getElementById(`section-${section}`)
  if (target instanceof HTMLDetailsElement) target.open = true
  target?.scrollIntoView?.({ block: 'start' })
  document.getElementById(`title-${section}`)?.focus({ preventScroll: true })
}
