import { useMutation } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Building2Icon, CheckCircleIcon } from 'lucide-react'

import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { acceptOrganizationInvitation } from '@/lib/admin'

export const Route = createFileRoute('/accept-invitation')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: AcceptInvitationPage,
})

function AcceptInvitationPage() {
  const { token } = Route.useSearch()
  const acceptance = useMutation({
    mutationFn: () => acceptOrganizationInvitation(token),
  })

  return (
    <div className="min-h-svh bg-background">
      <SiteHeader />
      <main className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-6xl place-items-center px-4 py-12">
        <Card className="w-full max-w-sm text-center">
          <CardHeader className="items-center">
            <div className="mb-2 grid size-12 place-items-center bg-muted">
              {acceptance.isSuccess ? (
                <CheckCircleIcon className="size-5 text-emerald-600" />
              ) : (
                <Building2Icon className="size-5" />
              )}
            </div>
            <CardTitle>
              {acceptance.isSuccess
                ? `Welcome to ${acceptance.data.organizationName}`
                : 'Organization invitation'}
            </CardTitle>
            <CardDescription>
              {acceptance.isSuccess
                ? 'Your membership is active.'
                : 'Sign in with the invited email, then accept this invitation.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {acceptance.error ? (
              <p className="text-sm text-destructive">
                {acceptance.error.message}
              </p>
            ) : null}
            {acceptance.isSuccess ? (
              <Button className="w-full" render={<Link to="/dashboard" />}>
                Go to dashboard
              </Button>
            ) : (
              <>
                <Button
                  className="w-full"
                  disabled={!token || acceptance.isPending}
                  onClick={() => acceptance.mutate()}
                >
                  {acceptance.isPending
                    ? 'Accepting…'
                    : 'Accept invitation'}
                </Button>
                <Button
                  className="w-full"
                  variant="outline"
                  render={<Link to="/login" />}
                >
                  Sign in first
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
