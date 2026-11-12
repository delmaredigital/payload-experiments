'use client'

import { useMemo } from 'react'
import { createApi } from './api.js'

export function useApi(apiRoute: string) {
  return useMemo(() => createApi(apiRoute), [apiRoute])
}
