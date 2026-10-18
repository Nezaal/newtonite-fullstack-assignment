import { useEffect, useState } from 'react'
import type { ItemFilters } from '../api/types'
import { PRIORITIES, STATUSES, TYPES, VIEWS } from './format'

// Filters live in the URL (?status=OPEN&view=overdue), so refresh, back and shared links all work.
// Anything in the URL that is not a valid value is ignored.
export function parseFilters(params: URLSearchParams): ItemFilters {
  const oneOf = <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
    const value = params.get(key)
    return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
  }
  const positiveInt = (key: string): number | undefined => {
    const value = Number(params.get(key))
    return Number.isInteger(value) && value > 0 ? value : undefined
  }
  const assigneeRaw = params.get('assignee')
  const assignee = assigneeRaw === 'me' || assigneeRaw === 'none' ? assigneeRaw : positiveInt('assignee')

  return {
    q: params.get('q')?.trim() || undefined,
    view: oneOf('view', VIEWS),
    teamId: positiveInt('teamId'),
    status: oneOf('status', STATUSES),
    priority: oneOf('priority', PRIORITIES),
    type: oneOf('type', TYPES),
    assignee,
  }
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
