import { createContext, useContext } from 'react'
import type { Database } from '../db/db'
import type { Kb } from '../kb/kb'
import type { Person } from '../types'

export interface AppState {
  db: Database
  kb: Kb
  persons: Person[]
  counts: Record<string, number>
  relationships: { parentId: string; childId: string }[]
  refresh: () => Promise<void>
}

export const AppContext = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('AppContext missing')
  return ctx
}

export const APP_VERSION = '0.1.0'
