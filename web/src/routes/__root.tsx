import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'

import { NotFound } from '@/components/not-found'
import type { RouterContext } from '@/router-context'

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
  notFoundComponent: NotFound,
})
