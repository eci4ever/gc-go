import { queryOptions } from '@tanstack/react-query'

import { AuthError } from '@/lib/auth'

export type Notification = {
  id: string
  userId: string
  type: string
  title: string
  body: string
  href: string | null
  readAt: string | null
  createdAt: string
}

export const notificationsQueryOptions = queryOptions({
  queryKey: ['notifications'] as const,
  queryFn: async () => {
    const response = await notificationRequest<{
      notifications: Notification[]
      unreadCount: number
    }>('/api/auth/notifications')
    return {
      ...response,
      notifications: response.notifications ?? [],
    }
  },
  refetchInterval: 30_000,
})

export function markNotificationRead(id: string) {
  return notificationRequest<void>(
    `/api/auth/notifications/${encodeURIComponent(id)}/read`,
    { method: 'POST' },
  )
}

export function markAllNotificationsRead() {
  return notificationRequest<{ updated: number }>(
    '/api/auth/notifications/read-all',
    { method: 'POST' },
  )
}

export function deleteNotification(id: string) {
  return notificationRequest<void>(
    `/api/auth/notifications/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export function clearReadNotifications() {
  return notificationRequest<{ deleted: number }>(
    '/api/auth/notifications/read',
    { method: 'DELETE' },
  )
}

async function notificationRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new AuthError(
      body && typeof body.error === 'string'
        ? body.error
        : 'Unable to update notifications',
    )
  }
  if (response.status === 204) {
    return undefined as T
  }
  return response.json()
}
