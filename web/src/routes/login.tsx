import { createFileRoute, redirect } from '@tanstack/react-router'

import { AuthForm } from '@/components/auth-form'
import { sessionQueryOptions } from '@/lib/auth'

export const Route = createFileRoute('/login')({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery({
      ...sessionQueryOptions,
      staleTime: 0,
    })
    if (session.user) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: Login,
})

function Login() {
  return <AuthForm mode="login" />
}
