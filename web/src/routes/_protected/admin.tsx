import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { sessionQueryOptions } from '@/lib/auth'

export const Route = createFileRoute('/_protected/admin')({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery({
      ...sessionQueryOptions,
      staleTime: 0,
    })
    if (
      session.user?.role !== 'admin' ||
      session.session?.impersonatedBy
    ) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: () => <Outlet />,
})
