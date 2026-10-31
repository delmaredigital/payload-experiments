'use client'

import { useLayoutEffect, useRef } from 'react'
import type * as React from 'react'
import type { ClientAssignments } from '../types/assignments.js'
import { registerApiRoute, unregisterApiRoute } from './beacon.js'
import { ExperimentsContext } from './context.js'

export function ExperimentsProvider(props: { value: ClientAssignments; children: React.ReactNode }): React.JSX.Element {
  const token = useRef(Symbol()).current
  // Register committed providers before descendants can send from passive effects.
  useLayoutEffect(() => { registerApiRoute(token, props.value.apiRoute) }, [token, props.value.apiRoute])
  useLayoutEffect(() => () => unregisterApiRoute(token), [token])
  return <ExperimentsContext.Provider value={props.value}>{props.children}</ExperimentsContext.Provider>
}
