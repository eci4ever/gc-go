import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'

import { AppSidebar } from '@/components/app-sidebar'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { Button } from '@/components/ui/button'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { logout, sessionQueryOptions } from '@/lib/auth'
import { stopImpersonation } from '@/lib/admin'

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
  const pageTitle =
    pathname === '/account'
      ? 'Account'
      : pathname === '/admin/users'
        ? 'Users'
        : pathname === '/admin/organizations'
          ? 'Organizations'
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
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <ThemeSwitcher />
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
