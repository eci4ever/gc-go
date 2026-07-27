import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { toast } from 'sonner'

import { AppSidebar } from '@/components/app-sidebar'
import { NotificationCenter } from '@/components/notification-center'
import { TeamSwitcher } from '@/components/team-switcher'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { logout, sessionQueryOptions } from '@/lib/auth'
import { stopImpersonation } from '@/lib/admin'
import {
  activateOrganizationTeam,
  accessibleOrganizationTeamsQueryOptions,
  organizationsQueryOptions,
  type OrganizationTeam,
} from '@/lib/organizations'

export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.fetchQuery({
      ...sessionQueryOptions,
      staleTime: 0,
    })
    if (!session.user) {
      throw redirect({ to: '/login' })
    }
    return { user: session.user, session: session.session }
  },
  component: ProtectedLayout,
})

function ProtectedLayout() {
  const { user, session } = Route.useRouteContext()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const organizations = useQuery(organizationsQueryOptions)
  const organizationSlug =
    pathname.match(/^\/organizations\/([^/]+)/)?.[1] ?? ''
  const activeOrganization = organizations.data?.organizations.find(
    (organization) => organization.slug === organizationSlug,
  )
  const teams = useQuery(
    accessibleOrganizationTeamsQueryOptions(activeOrganization?.slug ?? ''),
  )
  const routeTeamId =
    pathname.match(/^\/organizations\/[^/]+\/teams\/([^/]+)/)?.[1] ?? null
  const activeTeamId = routeTeamId ?? teams.data?.activeTeamId ?? null
  const activeTeam = teams.data?.teams.find(
    (team) => team.id === activeTeamId,
  )
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      queryClient.setQueryData(sessionQueryOptions.queryKey, {
        session: null,
        user: null,
      })
      await navigate({ to: '/' })
      await router.invalidate()
    },
  })
  const stopImpersonationMutation = useMutation({
    mutationFn: stopImpersonation,
    onSuccess: async (result) => {
      queryClient.setQueryData(sessionQueryOptions.queryKey, result)
      await navigate({ to: '/admin/users' })
      await router.invalidate()
    },
  })
  const activateTeamMutation = useMutation({
    mutationFn: (team: OrganizationTeam) =>
      activateOrganizationTeam(activeOrganization!.slug, team.id),
    onSuccess: async (_, team) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [
            'organizations',
            activeOrganization?.slug,
            'accessible-teams',
          ],
        }),
        queryClient.invalidateQueries({ queryKey: ['auth', 'session'] }),
      ])
      await navigate({
        to: '/organizations/$organizationSlug/teams/$teamId',
        params: {
          organizationSlug: activeOrganization!.slug,
          teamId: team.id,
        },
      })
    },
    onError: (error) => toast.error(error.message),
  })
  const pageTitle =
    pathname === '/account'
      ? 'Account'
      : pathname.includes('/members') && pathname.startsWith('/organizations/')
        ? 'Organization Members'
        : pathname.includes('/teams/') && pathname.startsWith('/organizations/')
          ? 'Team'
          : pathname.endsWith('/teams') && pathname.startsWith('/organizations/')
            ? 'Organization Teams'
            : pathname.endsWith('/settings') && pathname.startsWith('/organizations/')
              ? 'Organization Settings'
              : pathname.endsWith('/audit') && pathname.startsWith('/organizations/')
                ? 'Organization Audit'
                : pathname.startsWith('/organizations/')
                  ? 'Organization Overview'
      : pathname === '/admin/users'
        ? 'Users'
        : pathname.startsWith('/admin/organizations')
          ? 'Organizations'
          : pathname === '/admin/audit'
            ? 'Audit Log'
            : pathname === '/admin'
              ? 'Platform Overview'
          : 'Dashboard'

  return (
    <SidebarProvider>
      <AppSidebar
        user={user}
        onLogout={() => logoutMutation.mutate()}
        loggingOut={logoutMutation.isPending}
        platformAdmin={
          user.role === 'admin' && !session?.impersonatedBy
        }
      />
      <SidebarInset>
        {session?.impersonatedBy ? (
          <div className="flex items-center justify-between gap-4 border-b bg-muted px-4 py-2 text-xs">
            <span>
              You are impersonating <strong>{user.email}</strong>.
              {session.impersonationReason
                ? ` Reason: ${session.impersonationReason}.`
                : ''}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={stopImpersonationMutation.isPending}
              onClick={() => stopImpersonationMutation.mutate()}
            >
              {stopImpersonationMutation.isPending
                ? 'Returning…'
                : 'Stop impersonating'}
            </Button>
          </div>
        ) : null}
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb className="hidden sm:block">
              <BreadcrumbList>
                {activeOrganization ? (
                  <>
                    <BreadcrumbItem>
                      <BreadcrumbLink
                        render={
                          <Link
                            to="/organizations/$organizationSlug"
                            params={{
                              organizationSlug: activeOrganization.slug,
                            }}
                          />
                        }
                      >
                        {activeOrganization.name}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                    {routeTeamId ? (
                      <>
                        <BreadcrumbItem>
                          <BreadcrumbLink
                            render={
                              <Link
                                to="/organizations/$organizationSlug/teams"
                                params={{
                                  organizationSlug: activeOrganization.slug,
                                }}
                              />
                            }
                          >
                            Teams
                          </BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                          <BreadcrumbPage>
                            {activeTeam?.name ?? 'Team'}
                          </BreadcrumbPage>
                        </BreadcrumbItem>
                      </>
                    ) : (
                      <BreadcrumbItem>
                        <BreadcrumbPage>
                          {pageTitle.replace(/^Organization /, '')}
                        </BreadcrumbPage>
                      </BreadcrumbItem>
                    )}
                  </>
                ) : (
                  <BreadcrumbItem>
                    <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
                  </BreadcrumbItem>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="flex items-center gap-2">
            {activeOrganization && (
              <TeamSwitcher
                teams={teams.data?.teams ?? []}
                activeTeamId={activeTeamId}
                loading={teams.isPending}
                switching={activateTeamMutation.isPending}
                onSelect={(team) => activateTeamMutation.mutate(team)}
                onViewAll={() =>
                  navigate({
                    to: '/organizations/$organizationSlug/teams',
                    params: {
                      organizationSlug: activeOrganization.slug,
                    },
                  })
                }
              />
            )}
            <NotificationCenter />
            <ThemeSwitcher />
          </div>
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
