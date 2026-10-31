'use client'

import { useMemo } from 'react'
import { useConfig } from '@payloadcms/ui'
import { createApi } from './api.js'

export function useApi() {
  const { config } = useConfig()
  return useMemo(() => createApi(config.routes.api), [config.routes.api])
}
