'use client'

import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import type * as React from 'react'
import type { ClientAssignments } from '../types/assignments.js'
import { registerApiRoute, unregisterApiRoute } from './beacon.js'
import { registerClickGoals, unregisterClickGoals } from './clickGoals.js'
import { ExperimentsContext } from './context.js'

const DepthContext = createContext(0)

export function ExperimentsProvider(props: { value: ClientAssignments; children: React.ReactNode }): React.JSX.Element {
  const depth = useContext(DepthContext) + 1
  const token = useRef(Symbol()).current
  // Register committed providers before descendants can send from passive effects.
  useLayoutEffect(() => { registerApiRoute(token, props.value.apiRoute) }, [token, props.value.apiRoute])
  useLayoutEffect(() => () => unregisterApiRoute(token), [token])
  useLayoutEffect(() => { registerClickGoals(token, depth, props.value) }, [token, depth, props.value])
  useLayoutEffect(() => () => unregisterClickGoals(token), [token])
  return <DepthContext.Provider value={depth}><ExperimentsContext.Provider value={props.value}>{props.children}</ExperimentsContext.Provider></DepthContext.Provider>
}
