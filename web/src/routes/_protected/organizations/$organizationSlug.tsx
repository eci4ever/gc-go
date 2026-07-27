import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { organizationQueryOptions } from '@/lib/organizations'

export const Route = createFileRoute(
  '/_protected/organizations/$organizationSlug',
)({
  beforeLoad: async ({ context, params }) => {
    try {
      const result = await context.queryClient.fetchQuery(
        organizationQueryOptions(params.organizationSlug),
      )
      return { organization: result.organization }
    } catch {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: Outlet,
})
