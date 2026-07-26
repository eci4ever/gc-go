import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  Loader2Icon,
  MailCheckIcon,
} from 'lucide-react'

import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { sessionQueryOptions, verifyEmail } from '@/lib/auth'

export const Route = createFileRoute('/verify-email')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: VerifyEmailPage,
})

function VerifyEmailPage() {
  const { token } = Route.useSearch()
  const queryClient = useQueryClient()
  const verification = useQuery({
    queryKey: ['auth', 'email-verification', token],
    queryFn: async () => {
      if (!token) throw new Error('The verification link is incomplete.')
      await verifyEmail(token)
      await queryClient.invalidateQueries({
        queryKey: sessionQueryOptions.queryKey,
      })
      return true
    },
    retry: false,
    staleTime: Infinity,
  })

  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl place-items-center px-4 py-12 sm:px-6">
        <Card className="w-full max-w-md text-center">
          <CardHeader className="items-center">
            <div className="mb-2 grid size-12 place-items-center rounded-full bg-muted">
              {verification.isPending ? (
                <Loader2Icon className="size-5 animate-spin" />
              ) : verification.isSuccess ? (
                <CircleCheckIcon className="size-5 text-emerald-600" />
              ) : (
                <CircleAlertIcon className="size-5 text-destructive" />
              )}
            </div>
            <CardTitle>
              {verification.isPending
                ? 'Verifying your email'
                : verification.isSuccess
                  ? 'Email verified'
                  : 'Verification failed'}
            </CardTitle>
            <CardDescription>
              {verification.isPending
                ? 'Please wait while we confirm your verification link.'
                : verification.isSuccess
                  ? 'Your email address is confirmed and your security score has been updated.'
                  : verification.error?.message ||
                    'This verification link is invalid or has expired.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {verification.isSuccess ? (
              <Button className="w-full" render={<Link to="/account" />}>
                <MailCheckIcon />
                Continue to account
              </Button>
            ) : verification.isError ? (
              <Button
                className="w-full"
                variant="outline"
                render={<Link to="/account" />}
              >
                Request a new link
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
