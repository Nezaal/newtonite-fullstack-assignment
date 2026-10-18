import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { apiData, apiRequest } from './client'
import type {
  ActivityEvent,
  AppNotification,
  DashboardCounts,
  ItemComment,
  ItemDetail,
  ItemFilters,
  ItemSummary,
  Me,
  TeamMember,
} from './types'

// Refetch on tab focus (the TanStack default) and every 30 seconds, instead of websockets.
const LIVE_REFETCH_MS = 30_000

export const keys = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  items: (filters: ItemFilters) => ['items', filters] as const,
  item: (id: number) => ['item', id] as const,
  activity: (id: number) => ['activity', id] as const,
  comments: (id: number) => ['comments', id] as const,
  members: (teamId: number) => ['members', teamId] as const,
  notifications: ['notifications'] as const,
}

function itemsPath(filters: ItemFilters, cursor?: string): string {
  const params = new URLSearchParams({ limit: '25' })
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  if (cursor) params.set('cursor', cursor)
  return `/items?${params.toString()}`
}

export const useMe = (enabled: boolean) =>
  useQuery({ queryKey: keys.me, queryFn: () => apiData<Me>('/me'), enabled, staleTime: 5 * 60_000, retry: false })

export const useDashboard = () =>
  useQuery({
    queryKey: keys.dashboard,
    queryFn: () => apiData<DashboardCounts>('/dashboard'),
    refetchInterval: LIVE_REFETCH_MS,
  })

export const useItems = (filters: ItemFilters) =>
  useInfiniteQuery({
    queryKey: keys.items(filters),
    queryFn: ({ pageParam }) => apiRequest<ItemSummary[]>(itemsPath(filters, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    refetchInterval: LIVE_REFETCH_MS,
  })

export const useItem = (id: number) =>
  useQuery({
    queryKey: keys.item(id),
    queryFn: () => apiData<ItemDetail>(`/items/${id}`),
    enabled: id > 0,
    refetchInterval: LIVE_REFETCH_MS,
    // A 404 will not fix itself, so don't retry it.
    retry: (count, error) => !(error instanceof Error && 'status' in error && error.status === 404) && count < 2,
  })

export const useActivity = (id: number) =>
  useInfiniteQuery({
    queryKey: keys.activity(id),
    queryFn: ({ pageParam }) =>
      apiRequest<ActivityEvent[]>(`/items/${id}/activity?limit=15${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })

export const useComments = (id: number) =>
  useInfiniteQuery({
    queryKey: keys.comments(id),
    queryFn: ({ pageParam }) =>
      apiRequest<ItemComment[]>(`/items/${id}/comments?limit=15${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  })

export const useTeamMembers = (teamId: number, enabled: boolean) =>
  useQuery({ queryKey: keys.members(teamId), queryFn: () => apiData<TeamMember[]>(`/teams/${teamId}/members`), enabled })

export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => apiRequest<AppNotification[]>('/notifications'),
    refetchInterval: LIVE_REFETCH_MS,
  })
