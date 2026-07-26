import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { sessionQueryOptions } from '@/lib/auth'

export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery({
      ...sessionQueryOptions,
      staleTime: 0,
    })
    if (!session.user) {
      throw redirect({ to: '/login' })
    }
    return { user: session.user }
  },
  component: () => <Outlet />,
})
