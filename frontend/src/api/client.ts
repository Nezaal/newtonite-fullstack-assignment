import type { ItemDetail } from './types'

const BASE = '/api'
const TOKEN_KEY = 'ops.token'
export const AUTH_EXPIRED_EVENT = 'ops:auth-expired'

// Storage can be blocked (private windows), so every access is wrapped.
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore: the user just has to log in again next time */
  }
}

export interface FieldError {
  field: string
  message: string
}

// An error from the server, with the reason it gave. On a 409 it can carry the latest item.
export class ApiError extends Error {
  status: number
  code: string
  current?: ItemDetail
  details?: FieldError[]

  constructor(status: number, code: string, message: string, extra: { current?: ItemDetail; details?: FieldError[] } = {}) {
    super(message)
    this.status = status
    this.code = code
    this.current = extra.current
    this.details = extra.details
  }
}

interface Envelope<T> {
  success: boolean
  data: T
  error: { code: string; message: string; current?: ItemDetail; details?: FieldError[] } | null
  meta?: { nextCursor?: string | null; unreadCount?: number }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  idempotencyKey?: string
}

export interface ApiResult<T> {
  data: T
  meta: NonNullable<Envelope<T>['meta']>
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.')
  }

  let envelope: Envelope<T> | null = null
  try {
    envelope = (await response.json()) as Envelope<T>
  } catch {
    /* not JSON: handled below */
  }

  if (!response.ok || !envelope?.success) {
    const error = envelope?.error
    // A 401 on any call except login means the session ended.
    if (response.status === 401 && path !== '/auth/login') {
      setToken(null)
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    }
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'Something went wrong. Please try again.',
      { current: error?.current, details: error?.details },
    )
  }
  return { data: envelope.data, meta: envelope.meta ?? {} }
}

export async function apiData<T>(path: string, options?: RequestOptions): Promise<T> {
  return (await apiRequest<T>(path, options)).data
}

// A random key for one "attempt". Reusing it for retries and double clicks makes them safe.
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
