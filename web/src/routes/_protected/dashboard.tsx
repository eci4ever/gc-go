import { createFileRoute } from '@tanstack/react-router'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const Route = createFileRoute('/_protected/dashboard')({
  component: Dashboard,
})

function Dashboard() {
  const { user } = Route.useRouteContext()

  return (
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
