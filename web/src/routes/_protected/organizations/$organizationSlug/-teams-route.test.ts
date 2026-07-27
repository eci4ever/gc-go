import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import { routeTree } from '@/routeTree.gen'

describe('teams route layout', () => {
  it('keeps the list as an index route alongside nested team details', () => {
    const router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient() },
    })
    const routeIds = Object.keys(router.routesById)

    expect(routeIds).toContain(
      '/_protected/organizations/$organizationSlug/teams/',
    )
    expect(routeIds).toContain(
      '/_protected/organizations/$organizationSlug/teams/$teamId',
    )
  })
})
