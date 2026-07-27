import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellIcon, CheckCheckIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationsQueryOptions,
  type Notification,
} from '@/lib/notifications'
import { cn } from '@/lib/utils'

export function NotificationCenter() {
  const queryClient = useQueryClient()
  const notifications = useQuery(notificationsQueryOptions)
  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (error) => toast.error(error.message),
  })
  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (error) => toast.error(error.message),
  })
  const unreadCount = notifications.data?.unreadCount ?? 0

  function openNotification(notification: Notification) {
    if (!notification.readAt) {
      markRead.mutate(notification.id)
    }
    if (notification.href) {
      window.location.assign(notification.href)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              unreadCount
                ? `Notifications: ${unreadCount} unread`
                : 'Notifications'
            }
            className="relative"
          />
        }
      >
        <BellIcon />
        {unreadCount ? (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 min-w-5 justify-center px-1 text-[10px]"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </Badge>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-96 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Notifications</span>
            <span>{unreadCount} unread</span>
          </DropdownMenuLabel>
          {unreadCount ? (
            <DropdownMenuItem
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheckIcon />
              {markAllRead.isPending ? 'Marking…' : 'Mark all as read'}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {notifications.isPending ? (
            <DropdownMenuItem disabled>Loading notifications…</DropdownMenuItem>
          ) : notifications.isError ? (
            <DropdownMenuItem
              onClick={() => notifications.refetch()}
            >
              Unable to load. Try again
            </DropdownMenuItem>
          ) : notifications.data.notifications.length ? (
            notifications.data.notifications.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className={cn(
                  'items-start py-3 normal-case tracking-normal',
                  !notification.readAt && 'bg-muted',
                )}
                onClick={() => openNotification(notification)}
              >
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/30',
                    !notification.readAt && 'bg-primary',
                  )}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="truncate font-semibold">
                    {notification.title}
                  </span>
                  <span className="line-clamp-2 text-muted-foreground">
                    {notification.body}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatNotificationTime(notification.createdAt)}
                  </span>
                </span>
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>No notifications yet</DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function formatNotificationTime(value: string) {
  const createdAt = new Date(value)
  const elapsed = Date.now() - createdAt.getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return 'Just now'
  }
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return createdAt.toLocaleDateString()
}
