import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { dashboardQueryOptions } from './dashboard'
import { server } from '@/test/server'

describe('dashboard API client', () => {
  it('loads the authenticated security summary', async () => {
    const summary = {
      securityScore: 70,
      activeSessions: 2,
      twoFactorEnabled: true,
      emailVerified: false,
      signInActivity: [{ date: '2026-07-26', signIns: 2 }],
      recentSessions: [],
    }
    server.use(
      http.get('/api/dashboard', () => HttpResponse.json(summary)),
    )
    const queryClient = new QueryClient()

    await expect(
      queryClient.fetchQuery(dashboardQueryOptions),
    ).resolves.toEqual(summary)
  })

  it('surfaces dashboard API errors', async () => {
    server.use(
      http.get('/api/dashboard', () =>
        HttpResponse.json(
          { error: 'Authentication required' },
          { status: 401 },
        ),
      ),
    )
    const queryClient = new QueryClient()

    await expect(
      queryClient.fetchQuery(dashboardQueryOptions),
    ).rejects.toThrow('Authentication required')
  })
})
