import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  addTeamMember,
  organizationMembersQueryOptions,
  organizationTeamsQueryOptions,
  removeTeamMember,
  teamMembersQueryOptions,
  updateOrganizationTeam,
} from '@/lib/organizations'

export const Route = createFileRoute(
  '/_protected/organizations/$organizationSlug/teams/$teamId',
)({ component: TeamDetails })

function TeamDetails() {
  const { organization } = Route.useRouteContext()
  const { organizationSlug, teamId } = Route.useParams()
  const queryClient = useQueryClient()
  const teams = useQuery(organizationTeamsQueryOptions(organizationSlug))
  const organizationMembers = useQuery(
    organizationMembersQueryOptions(organizationSlug),
  )
  const teamMembers = useQuery(teamMembersQueryOptions(organizationSlug, teamId))
  const team = teams.data?.teams.find((item) => item.id === teamId)
  const canManage = organization.role === 'owner' || organization.role === 'admin'
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [leadUserId, setLeadUserId] = useState('')
  useEffect(() => {
    if (!team) return
    setName(team.name)
    setDescription(team.description ?? '')
    setLeadUserId(team.leadUserId ?? '')
  }, [team])
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ['organizations', organizationSlug, 'teams', teamId, 'members'],
    })
  const add = useMutation({
    mutationFn: (userId: string) =>
      addTeamMember(organizationSlug, teamId, userId),
    onSuccess: async () => {
      toast.success('Member added to team')
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: (userId: string) =>
      removeTeamMember(organizationSlug, teamId, userId),
    onSuccess: async () => {
      toast.success('Member removed from team')
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const update = useMutation({
    mutationFn: () =>
      updateOrganizationTeam(organizationSlug, teamId, {
        name,
        description,
        leadUserId,
      }),
    onSuccess: async () => {
      toast.success('Team details updated')
      await queryClient.invalidateQueries({
        queryKey: ['organizations', organizationSlug, 'teams'],
      })
    },
    onError: (error) => toast.error(error.message),
  })
  const assigned = new Set(teamMembers.data?.members.map((member) => member.userId))
  const available =
    organizationMembers.data?.members.filter(
      (member) => !assigned.has(member.userId),
    ) ?? []

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div>
        <h1 className="font-heading text-xl font-semibold tracking-wide uppercase">
          {team?.name ?? 'Team'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {team?.description || 'Manage this team and its members.'}
        </p>
      </div>
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Team details</CardTitle>
            <CardDescription>Update its purpose and team lead.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="team-detail-name">Name</Label>
              <Input
                id="team-detail-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Team lead</Label>
              <Select
                value={leadUserId}
                onValueChange={(value) => setLeadUserId(String(value ?? ''))}
              >
                <SelectTrigger><SelectValue placeholder="No team lead" /></SelectTrigger>
                <SelectContent>
                  {organizationMembers.data?.members.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="team-detail-description">Description</Label>
              <Input
                id="team-detail-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button
                disabled={!name || update.isPending}
                onClick={() => update.mutate()}
              >
                {update.isPending ? 'Saving…' : 'Save team'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Team members</CardTitle>
            <CardDescription>{teamMembers.data?.members.length ?? 0} assigned</CardDescription>
          </div>
          {canManage && available.length > 0 && (
            <Select
              onValueChange={(value) => value && add.mutate(String(value))}
            >
              <SelectTrigger className="w-52"><SelectValue placeholder="Add member…" /></SelectTrigger>
              <SelectContent>
                {available.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardHeader>
        <CardContent className="divide-y p-0">
          {teamMembers.data?.members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 px-6 py-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="truncate text-xs text-muted-foreground">{member.email}</p>
              </div>
              {team?.leadUserId === member.userId && <Badge>Team lead</Badge>}
              <Badge variant="secondary">{member.organizationRole}</Badge>
              {canManage && (
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(member.userId)}>
                  Remove
                </Button>
              )}
            </div>
          ))}
          {!teamMembers.isPending && !teamMembers.data?.members.length && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              This team has no members.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
