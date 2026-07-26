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
  component: ProtectedLayout,
})

function ProtectedLayout() {
  const { user } = Route.useRouteContext()
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
  const pageTitle = pathname === '/account' ? 'Account' : 'Dashboard'

  return (
    <SidebarProvider>
      <AppSidebar
        user={user}
        onLogout={() => logoutMutation.mutate()}
        loggingOut={logoutMutation.isPending}
      />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
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
        </header>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  )
}
