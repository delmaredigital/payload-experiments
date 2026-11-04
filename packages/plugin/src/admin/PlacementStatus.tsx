'use client'
import { useConfig, useDocumentInfo } from '@payloadcms/ui'
import { useEffect, useMemo, useState } from 'react'
import type { UIFieldClientProps } from 'payload'
import type { PageTestStatus } from '../types/endpoints.js'
import { createApi } from './api.js'
import { pageStatusCopy } from './placementStatus.model.js'

/** Manage-only endpoint: access-filtered editors see no status or error text. */
export function PlacementStatus(_props: UIFieldClientProps) {
  const { id, collectionSlug } = useDocumentInfo()
  const { config } = useConfig()
  const api = useMemo(() => createApi(config.routes.api), [config.routes.api])
  const [tests, setTests] = useState<PageTestStatus[]>([])
  useEffect(() => {
    let active = true
    setTests([])
    if (id != null && collectionSlug) void api.placementStatus({ docs: [{ collection: collectionSlug, id }] }).then(result => {
      if (active && result.ok) setTests(result.data?.docs[`${collectionSlug}:${id}`]?.tests ?? [])
    })
    return () => { active = false }
  }, [api, collectionSlug, id])
  return <>{tests.map(test => {
    const copy = pageStatusCopy(test)
    return copy ? <p key={test.slug}>{copy}{' '}<a href={`${config.routes.admin.replace(/\/$/, '')}/experiments/by-slug/${encodeURIComponent(test.slug)}`}>Back to the test</a></p> : null
  })}</>
}
