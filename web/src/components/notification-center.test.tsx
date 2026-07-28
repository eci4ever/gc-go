import { http, HttpResponse } from 'msw'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { NotificationCenter } from './notification-center'
import { renderWithQuery } from '@/test/render'
import { server } from '@/test/server'

describe('NotificationCenter', () => {
  it('shows unread notifications and marks all as read', async () => {
    let unreadCount = 1
    let notificationsCleared = false
    server.use(
      http.get('/api/auth/notifications', () =>
        HttpResponse.json({
          unreadCount,
          notifications: notificationsCleared
            ? []
            : [
                {
                  id: 'notification-1',
                  userId: 'user-1',
                  type: 'team',
                  title: 'Added to team',
                  body: 'You were added to Platform in Acme.',
                  href: null,
                  readAt: unreadCount ? null : '2026-07-27T12:00:00Z',
                  createdAt: '2026-07-27T12:00:00Z',
                },
              ],
        }),
      ),
      http.post('/api/auth/notifications/read-all', () => {
        unreadCount = 0
        return HttpResponse.json({ updated: 1 })
      }),
      http.delete('/api/auth/notifications/read', () => {
        notificationsCleared = true
        return HttpResponse.json({ deleted: 1 })
      }),
    )
    const user = userEvent.setup()
    renderWithQuery(<NotificationCenter />)

    await user.click(
      await screen.findByRole('button', {
        name: 'Notifications: 1 unread',
      }),
    )

    expect(await screen.findByText('Added to team')).toBeInTheDocument()
    await user.click(screen.getByText('Mark all as read'))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Notifications' }),
      ).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'Notifications' }))
    await user.click(await screen.findByText('Clear all read'))

    await user.click(screen.getByRole('button', { name: 'Notifications' }))
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument()
  })

  it('deletes an individual notification', async () => {
    let deleted = false
    server.use(
      http.get('/api/auth/notifications', () =>
        HttpResponse.json({
          unreadCount: deleted ? 0 : 1,
          notifications: deleted
            ? []
            : [
                {
                  id: 'notification-1',
                  userId: 'user-1',
                  type: 'team',
                  title: 'Added to team',
                  body: 'You were added to Platform in Acme.',
                  href: null,
                  readAt: null,
                  createdAt: '2026-07-27T12:00:00Z',
                },
              ],
        }),
      ),
      http.delete('/api/auth/notifications/notification-1', () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = userEvent.setup()
    renderWithQuery(<NotificationCenter />)

    await user.click(
      await screen.findByRole('button', {
        name: 'Notifications: 1 unread',
      }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Delete Added to team' }),
    )

    expect(await screen.findByText('No notifications yet')).toBeInTheDocument()
  })
})
