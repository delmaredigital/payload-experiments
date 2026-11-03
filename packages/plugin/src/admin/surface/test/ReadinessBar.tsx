'use client'
import { useLayoutEffect, useRef } from 'react'
import type { SectionProps } from '../contracts.js'
import { ReadinessContent } from '../readiness/Banner.js'

/** Measure wrapping actions/copy so the final section always clears the fixed bar. */
export function ReadinessBar({ onHeightChange, ...props }: SectionProps & { onHeightChange: (height: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => onHeightChange(node.getBoundingClientRect().height)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(node)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [onHeightChange])
  return <div ref={ref} className="xp-test-readiness-bar" role="region" aria-label="Readiness">
    {props.test.doc ? <ReadinessContent key={`${props.test.doc.id}/${props.test.doc.status}`} {...props} bar /> : null}
  </div>
}
