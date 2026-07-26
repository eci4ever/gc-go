import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'

import { AppSidebar } from '@/components/app-sidebar'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

export const Route = createFileRoute('/_protected/dashboard')({
  component: Dashboard,
})

function Dashboard() {
  const { user } = Route.useRouteContext()
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
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>Dashboard</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="grid auto-rows-min gap-4 md:grid-cols-3">
            <UserCard label="Name" value={user.name} />
            <UserCard label="Email" value={user.email} />
            <Card>
              <CardHeader>
                <CardDescription>Role</CardDescription>
                <CardTitle>
                  <Badge variant="secondary">{user.role}</Badge>
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Welcome, {user.name}</CardTitle>
              <CardDescription>
                Your authenticated dashboard session is active.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Account ID: {user.id}
            </CardContent>
          </Card>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function UserCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="truncate">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}
