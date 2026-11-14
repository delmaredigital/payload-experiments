'use client'
import { Banner } from '../../ui/Banner.js'
import { Button } from '../../ui/Button.js'
import type { ReadinessRead } from '../../testSurface/readinessRead.js'
import { editorCopy } from './copy.js'

/** Chrome and sidebar consume the settled read's sentence and recovery policy. */
export function PlacementNotice({ read, message, running, onRetry }: {
  read?: ReadinessRead; message?: string; running: boolean; onRetry(): void
}) {
  const sentence = read?.message ?? message
  return sentence ? <Banner tone={running && !read?.message ? 'warning' : 'error'} action={read?.retry ? <Button onClick={onRetry}>{editorCopy.retrySetup}</Button> : undefined}>
    {running && !read?.message ? <span aria-hidden="true">⚠ </span> : null}{sentence}
  </Banner> : null
}
