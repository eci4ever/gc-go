import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

export function createAppRouter(queryClient = new QueryClient()) {
  return createRouter({
    routeTree,
    notFoundMode: 'root',
    context: {
      queryClient,
    },
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>
