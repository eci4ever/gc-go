import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellIcon, CheckCheckIcon, Trash2Icon } from 'lucide-react'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  clearReadNotifications,
  deleteNotification,
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
  const remove = useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => {
      toast.success('Notification deleted')
      return queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (error) => toast.error(error.message),
  })
  const clearRead = useMutation({
    mutationFn: clearReadNotifications,
    onSuccess: (result) => {
      toast.success(
        result.deleted === 1
          ? '1 read notification cleared'
          : `${result.deleted} read notifications cleared`,
      )
      return queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: (error) => toast.error(error.message),
  })
  const unreadCount = notifications.data?.unreadCount ?? 0
  const hasReadNotifications =
    (notifications.data?.notifications.length ?? 0) > unreadCount

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
          {hasReadNotifications ? (
            <DropdownMenuItem
              disabled={clearRead.isPending}
              onClick={() => clearRead.mutate()}
            >
              <Trash2Icon />
              {clearRead.isPending ? 'Clearing…' : 'Clear all read'}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <ScrollArea className="max-h-96">
          <DropdownMenuGroup>
            {notifications.isPending ? (
              <DropdownMenuItem disabled className="flex flex-col gap-2 py-3">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <span className="sr-only">Loading notifications…</span>
              </DropdownMenuItem>
            ) : notifications.isError ? (
              <DropdownMenuItem onClick={() => notifications.refetch()}>
                Unable to load. Try again
              </DropdownMenuItem>
            ) : notifications.data.notifications.length ? (
              notifications.data.notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={cn(
                    'flex items-start gap-1 px-1 py-1',
                    !notification.readAt && 'bg-muted',
                  )}
                >
                  <Button
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 justify-start px-2 py-2 text-left normal-case tracking-normal"
                    onClick={() => openNotification(notification)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-1 size-2 shrink-0 rounded-full bg-muted-foreground/30',
                        !notification.readAt && 'bg-primary',
                      )}
                    />
                    <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                      <span className="max-w-full truncate font-semibold">
                        {notification.title}
                      </span>
                      <span className="line-clamp-2 max-w-full text-muted-foreground">
                        {notification.body}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {formatNotificationTime(notification.createdAt)}
                      </span>
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${notification.title}`}
                    disabled={
                      remove.isPending &&
                      remove.variables === notification.id
                    }
                    onClick={() => remove.mutate(notification.id)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
              ))
            ) : (
              <DropdownMenuItem disabled>No notifications yet</DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </ScrollArea>
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
  const relativeTime = new Intl.RelativeTimeFormat(undefined, {
    numeric: 'auto',
    style: 'narrow',
  })
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return relativeTime.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return relativeTime.format(-hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 7) return relativeTime.format(-days, 'day')
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(createdAt)
}
