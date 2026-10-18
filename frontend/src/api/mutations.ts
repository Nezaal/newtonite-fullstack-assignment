import { useMutation, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/auth-context'
import { useToast } from '../components/toast-context'
import { ApiError, apiData, apiRequest } from './client'
import { keys } from './queries'
import type { ApiResult } from './client'
import type { ItemComment, ItemDetail, ItemSummary, Me, Priority, Status } from './types'

type ItemPages = InfiniteData<ApiResult<ItemSummary[]>>

// After any change, everything that shows items is stale.
function refreshItemViews(queryClient: QueryClient, id: number): void {
  void queryClient.invalidateQueries({ queryKey: keys.item(id) })
  void queryClient.invalidateQueries({ queryKey: ['items'] })
  void queryClient.invalidateQueries({ queryKey: keys.dashboard })
  void queryClient.invalidateQueries({ queryKey: keys.activity(id) })
}

// Changes one item inside every cached list page.
function patchListCaches(queryClient: QueryClient, id: number, change: (item: ItemSummary) => ItemSummary): void {
  queryClient.setQueriesData<ItemPages>({ queryKey: ['items'] }, (data) =>
    data
      ? { ...data, pages: data.pages.map((page) => ({ ...page, data: page.data.map((i) => (i.id === id ? change(i) : i)) })) }
      : data,
  )
}

interface Snapshot {
  detail: ItemDetail | undefined
  lists: [readonly unknown[], ItemPages | undefined][]
}

function takeSnapshot(queryClient: QueryClient, id: number): Snapshot {
  return {
    detail: queryClient.getQueryData<ItemDetail>(keys.item(id)),
    lists: queryClient.getQueriesData<ItemPages>({ queryKey: ['items'] }),
  }
}

// A list card only has the summary. Fill in the rest with empty values; it is never shown or saved.
function stubFromLists(snapshot: Snapshot, id: number): ItemDetail | undefined {
  for (const [, data] of snapshot.lists) {
    const summary = data?.pages.flatMap((p) => p.data).find((i) => i.id === id)
    if (summary) {
      const noActions = { edit: false, claim: false, release: false, assign: false, moveTeam: false, comment: false }
      return { ...summary, description: '', createdBy: { id: 0, name: '' }, actions: noActions, transitions: [] }
    }
  }
  return undefined
}

function restoreSnapshot(queryClient: QueryClient, id: number, snapshot: Snapshot): void {
  queryClient.setQueryData(keys.item(id), snapshot.detail)
  for (const [key, data] of snapshot.lists) queryClient.setQueryData(key, data)
}

// What the item should look like if the server says yes. Shown instantly, then replaced by the real answer.
type Optimistic<V> = (item: ItemDetail, vars: V, me: Me['user']) => ItemDetail

interface ItemMutationConfig<V> {
  id: number
  call: (vars: V) => Promise<ItemDetail>
  optimistic?: Optimistic<V>
  success: string
}

// One recipe for every item action:
// 1) update the screen immediately, 2) if the server refuses, put the old data back and say why,
// 3) if the item had changed under us (409), show the latest version instead.
export function useItemMutation<V = void>(config: ItemMutationConfig<V>) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { me } = useAuth()
  const { id } = config

  return useMutation<ItemDetail, Error, V, Snapshot>({
    mutationFn: config.call,
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: keys.item(id) })
      const snapshot = takeSnapshot(queryClient, id)
      // Works from the item page (full item cached) and from a list card (only the summary is cached).
      const base = snapshot.detail ?? stubFromLists(snapshot, id)
      if (base && config.optimistic && me) {
        const guess = config.optimistic(base, vars, me.user)
        if (snapshot.detail) queryClient.setQueryData(keys.item(id), guess)
        patchListCaches(queryClient, id, (i) => ({ ...i, status: guess.status, assignee: guess.assignee, version: guess.version }))
      }
      return snapshot
    },
    onError: (error, _vars, snapshot) => {
      if (snapshot) restoreSnapshot(queryClient, id, snapshot)
      // The server sends the latest item with a 409: show that, not our stale copy.
      if (error instanceof ApiError && error.current) queryClient.setQueryData(keys.item(id), error.current)
      toast.error(error.message)
    },
    onSuccess: (item) => {
      queryClient.setQueryData(keys.item(id), item)
      toast.success(config.success)
    },
    onSettled: () => refreshItemViews(queryClient, id),
  })
}

const bump = (item: ItemDetail): number => item.version + 1

export const useClaim = (id: number) =>
  useItemMutation({
    id,
    call: () => apiData<ItemDetail>(`/items/${id}/claim`, { method: 'POST' }),
    optimistic: (item, _v, me) => ({
      ...item,
      assignee: { id: me.id, name: me.name },
      version: bump(item),
      actions: { ...item.actions, claim: false, release: true },
    }),
    success: 'You claimed this item',
  })

export const useRelease = (id: number) =>
  useItemMutation({
    id,
    call: () => apiData<ItemDetail>(`/items/${id}/release`, { method: 'POST' }),
    optimistic: (item) => ({
      ...item,
      assignee: null,
      status: item.status === 'IN_PROGRESS' ? 'OPEN' : item.status,
      version: bump(item),
      transitions: [],
      actions: { ...item.actions, release: false, claim: true },
    }),
    success: 'Item released',
  })

interface AssignVars {
  assigneeId: number
  assigneeName: string
  version: number
}

export const useAssign = (id: number) =>
  useItemMutation<AssignVars>({
    id,
    call: (v) => apiData<ItemDetail>(`/items/${id}/assign`, { method: 'POST', body: { assigneeId: v.assigneeId, version: v.version } }),
    optimistic: (item, v) => ({ ...item, assignee: { id: v.assigneeId, name: v.assigneeName }, version: bump(item) }),
    success: 'Item assigned',
  })

interface TransitionVars {
  to: Status
  version: number
  reason?: string
}

export const useTransition = (id: number) =>
  useItemMutation<TransitionVars>({
    id,
    call: (v) => apiData<ItemDetail>(`/items/${id}/transition`, { method: 'POST', body: v }),
    optimistic: (item, v) => ({ ...item, status: v.to, version: bump(item), transitions: [] }),
    success: 'Status updated',
  })

export interface EditVars {
  version: number
  title?: string
  description?: string
  priority?: Priority
  dueDate?: string | null
  teamId?: number
}

export const useEditItem = (id: number) =>
  useItemMutation<EditVars>({
    id,
    call: (v) => apiData<ItemDetail>(`/items/${id}`, { method: 'PATCH', body: v }),
    success: 'Changes saved',
  })

export interface CreateVars {
  teamId: number
  title: string
  description: string
  type: string
  priority: Priority
  dueDate?: string | null
  idempotencyKey: string
}

export function useCreateItem() {
  const queryClient = useQueryClient()
  return useMutation<ItemDetail, Error, CreateVars>({
    mutationFn: ({ idempotencyKey, ...body }) =>
      apiData<ItemDetail>('/items', { method: 'POST', body, idempotencyKey }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['items'] })
      void queryClient.invalidateQueries({ queryKey: keys.dashboard })
    },
  })
}

export function useAddComment(itemId: number) {
  const queryClient = useQueryClient()
  return useMutation<ItemComment, Error, { body: string; idempotencyKey: string }>({
    mutationFn: ({ body, idempotencyKey }) =>
      apiRequest<ItemComment>(`/items/${itemId}/comments`, { method: 'POST', body: { body }, idempotencyKey }).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.comments(itemId) })
      void queryClient.invalidateQueries({ queryKey: keys.activity(itemId) })
    },
  })
}

export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, number>({
    mutationFn: (id) => apiData(`/notifications/${id}/read`, { method: 'POST' }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: keys.notifications }),
  })
}
