import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute(
  '/_protected/organizations/$organizationSlug/teams',
)({ component: Outlet })
