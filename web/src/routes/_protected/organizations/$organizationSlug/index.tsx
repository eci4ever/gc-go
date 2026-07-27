import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Building2Icon, ShieldCheckIcon, UsersIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  organizationMembersQueryOptions,
  organizationTeamsQueryOptions,
} from '@/lib/organizations'

export const Route = createFileRoute(
  '/_protected/organizations/$organizationSlug/',
)({ component: OrganizationOverview })

function OrganizationOverview() {
  const { organization } = Route.useRouteContext()
  const { organizationSlug } = Route.useParams()
  const members = useQuery(organizationMembersQueryOptions(organizationSlug))
  const teams = useQuery(organizationTeamsQueryOptions(organizationSlug))
  const activeTeams = teams.data?.teams.filter((team) => !team.archivedAt) ?? []

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-xl font-semibold tracking-wide uppercase">
              {organization.name}
            </h1>
            <Badge variant="secondary">{organization.role}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Organization workspace overview.
          </p>
        </div>
        {(organization.role === 'owner' || organization.role === 'admin') && (
          <Button
            variant="outline"
            render={
              <Link
                to="/organizations/$organizationSlug/members"
                params={{ organizationSlug }}
              />
            }
          >
            Manage members
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric
          icon={UsersIcon}
          label="Members"
          value={members.data?.members.length ?? 0}
          description={`${members.data?.invitations.filter((item) => item.status === 'pending').length ?? 0} pending invitations`}
        />
        <Metric
          icon={Building2Icon}
          label="Active teams"
          value={activeTeams.length}
          description="Teams currently available"
        />
        <Metric
          icon={ShieldCheckIcon}
          label="Your access"
          value={organization.role}
          description="Organization-level role"
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>
            Keep members organized into focused teams and review access regularly.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            render={
              <Link
                to="/organizations/$organizationSlug/teams"
                params={{ organizationSlug }}
              />
            }
          >
            View teams
          </Button>
          <Button
            variant="outline"
            render={
              <Link
                to="/organizations/$organizationSlug/members"
                params={{ organizationSlug }}
              />
            }
          >
            View members
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  description,
}: {
  icon: typeof UsersIcon
  label: string
  value: string | number
  description: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardDescription>{label}</CardDescription>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold capitalize">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}
