'use client'

import { useContext, useEffect } from 'react'
import { sendExposure } from './beacon.js'
import { ExperimentsContext } from './context.js'

export function ExperimentPageview(): null {
  const value = useContext(ExperimentsContext)
  const pageviews = value?.pageviews
  const apiRoute = value?.apiRoute
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  useEffect(() => {
    if (!pageviews || apiRoute === undefined) return
    for (const { slug, phase, arm } of pageviews) {
      sendExposure(apiRoute, { type: 'exposure', experiment: slug, phase, arm, policy: 'pageview' }, pathname)
    }
  }, [pageviews, apiRoute, pathname])
  return null
}
