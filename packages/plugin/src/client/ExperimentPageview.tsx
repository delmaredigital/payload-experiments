'use client'

import { useContext, useEffect } from 'react'
import { sendExposure } from './beacon.js'
import { ExperimentsContext } from './context.js'

export function ExperimentPageview(): null {
  const value = useContext(ExperimentsContext)
  const pageviews = value?.pageviews
  const apiRoute = value?.apiRoute
  useEffect(() => {
    if (!pageviews || apiRoute === undefined) return
    // Read the path at commit time: on an App Router soft navigation the new page renders before the URL updates.
    const pathname = window.location.pathname
    for (const { slug, phase, arm } of pageviews) {
      sendExposure(apiRoute, { type: 'exposure', experiment: slug, phase, arm, policy: 'pageview' }, pathname)
    }
  }, [pageviews, apiRoute])
  return null
}
