import { queryOptions } from '@tanstack/react-query'

import { AuthError, type ManagedSession } from './auth'

export type DashboardSummary = {
  securityScore: number
  activeSessions: number
  twoFactorEnabled: boolean
  emailVerified: boolean
  signInActivity: Array<{
    date: string
    signIns: number
  }>
  recentSessions: ManagedSession[]
}

export const dashboardQueryOptions = queryOptions({
  queryKey: ['dashboard'] as const,
  queryFn: async () => {
    const response = await fetch('/api/dashboard', {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new AuthError(
        body && typeof body.error === 'string'
          ? body.error
          : 'Unable to load dashboard',
      )
    }
    return response.json() as Promise<DashboardSummary>
  },
  staleTime: 30_000,
  retry: false,
})
