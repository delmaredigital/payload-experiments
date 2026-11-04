'use client'

import { createContext, useContext } from 'react'

import { resolvePuckRoutes } from './routes.js'
import type { ReactNode } from 'react'

const PuckHostContext = createContext(resolvePuckRoutes())
export const usePuckRoutes = () => useContext(PuckHostContext)

export function PuckHostProvider({ routes, children }: { routes: ReturnType<typeof resolvePuckRoutes>; children: ReactNode }) {
  return <PuckHostContext.Provider value={routes}>{children}</PuckHostContext.Provider>
}
