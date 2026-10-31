import { createContext } from 'react'
import type { ClientAssignments } from '../types/assignments.js'

export const ExperimentsContext = createContext<ClientAssignments | null>(null)
