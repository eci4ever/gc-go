import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { ArchiveIcon, MailPlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@/components/data-table'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  archiveOrganizationTeam,
  bulkUpdateTeamMembers,
  cancelOrganizationInvitation,
  deleteOrganizationTeam,
  inviteOrganizationMember,
  organizationMembersQueryOptions,
  organizationTeamsQueryOptions,
  teamMembersQueryOptions,
  updateOrganizationTeam,
  type TeamMember,
  type OrganizationInvitation,
} from '@/lib/organizations'

const teamRoute = getRouteApi(
  '/_protected/organizations/$organizationSlug/teams/$teamId',
)

type MemberRow = TeamMember & { search: string }
type InvitationRow = OrganizationInvitation & { search: string }
type Confirmation = 'archive' | 'restore' | 'delete' | null

export function TeamDetails() {
  const { organization } = teamRoute.useRouteContext()
  const { organizationSlug, teamId } = teamRoute.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const teams = useQuery(organizationTeamsQueryOptions(organizationSlug))
  const organizationMembers = useQuery(organizationMembersQueryOptions(organizationSlug))
  const teamMembers = useQuery(teamMembersQueryOptions(organizationSlug, teamId))
  const team = teams.data?.teams.find((item) => item.id === teamId)
  const canManage = organization.role === 'owner' || organization.role === 'admin'
  const canDelete = organization.role === 'owner'
  const archived = Boolean(team?.archivedAt)
  const editable = canManage && !archived
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [leadUserId, setLeadUserId] = useState('')
  const [selectedAssigned, setSelectedAssigned] = useState<string[]>([])
  const [selectedAvailable, setSelectedAvailable] = useState<string[]>([])
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')

  useEffect(() => {
    if (!team) return
    setName(team.name)
    setDescription(team.description ?? '')
    setLeadUserId(team.leadUserId ?? '')
  }, [team])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['organizations', organizationSlug, 'teams'] }),
      queryClient.invalidateQueries({
        queryKey: ['organizations', organizationSlug, 'teams', teamId, 'members'],
      }),
    ])
  }
  const bulk = useMutation({
    mutationFn: (input: { action: 'add' | 'remove'; userIds: string[] }) =>
      bulkUpdateTeamMembers(organizationSlug, teamId, input),
    onSuccess: async (result, input) => {
      toast.success(
        input.action === 'add'
          ? `${result.changedCount} member${result.changedCount === 1 ? '' : 's'} added`
          : `${result.changedCount} member${result.changedCount === 1 ? '' : 's'} removed`,
      )
      setSelectedAssigned([])
      setSelectedAvailable([])
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const update = useMutation({
    mutationFn: () => updateOrganizationTeam(organizationSlug, teamId, { name, description, leadUserId }),
    onSuccess: async () => {
      toast.success('Team details updated')
      await refresh()
    },
    onError: (error) => toast.error(error.message),
  })
  const lifecycle = useMutation({
    mutationFn: async (action: Exclude<Confirmation, null>) => {
      if (action === 'delete') return deleteOrganizationTeam(organizationSlug, teamId)
      return archiveOrganizationTeam(organizationSlug, teamId, action === 'archive')
    },
    onSuccess: async (_, action) => {
      setConfirmation(null)
      toast.success(action === 'delete' ? 'Team deleted' : action === 'archive' ? 'Team archived' : 'Team restored')
      if (action === 'delete') {
        await queryClient.invalidateQueries({ queryKey: ['organizations', organizationSlug, 'teams'] })
        await navigate({ to: '/organizations/$organizationSlug/teams', params: { organizationSlug } })
      } else {
        await refresh()
      }
    },
    onError: (error) => toast.error(error.message),
  })
  const invite = useMutation({
    mutationFn: () => inviteOrganizationMember(organizationSlug, {
      email: inviteEmail,
      role: inviteRole,
      teamId,
    }),
    onSuccess: async () => {
      setInviteOpen(false)
      setInviteEmail('')
      setInviteRole('member')
      toast.success('Team invitation sent')
      await queryClient.invalidateQueries({
        queryKey: ['organizations', organizationSlug, 'members'],
      })
    },
    onError: (error) => toast.error(error.message),
  })
  const cancelInvite = useMutation({
    mutationFn: (invitationId: string) =>
      cancelOrganizationInvitation(organizationSlug, invitationId),
    onSuccess: async () => {
      toast.success('Invitation cancelled')
      await queryClient.invalidateQueries({
        queryKey: ['organizations', organizationSlug, 'members'],
      })
    },
    onError: (error) => toast.error(error.message),
  })

  const assignedIDs = new Set(teamMembers.data?.members.map((member) => member.userId))
  const assignedRows = useMemo<MemberRow[]>(
    () => (teamMembers.data?.members ?? []).map((member) => ({
      ...member, search: `${member.name} ${member.email}`,
    })),
    [teamMembers.data?.members],
  )
  const availableRows = useMemo<MemberRow[]>(
    () => (organizationMembers.data?.members ?? [])
      .filter((member) => !assignedIDs.has(member.userId))
      .map((member) => ({
        id: member.id,
        userId: member.userId,
        name: member.name,
        email: member.email,
        image: member.image,
        organizationRole: member.role,
        createdAt: member.createdAt,
        search: `${member.name} ${member.email}`,
      })),
    [organizationMembers.data?.members, teamMembers.data?.members],
  )
  const pendingInvitations = useMemo<InvitationRow[]>(
    () => (organizationMembers.data?.invitations ?? [])
      .filter((invitation) => invitation.teamId === teamId && invitation.status === 'pending')
      .map((invitation) => ({ ...invitation, search: invitation.email })),
    [organizationMembers.data?.invitations, teamId],
  )
  const invitationColumns: ColumnDef<InvitationRow>[] = [
    {
      accessorKey: 'search',
      header: 'Pending invitation',
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.email}</p>
          <p className="text-xs text-muted-foreground">
            Expires {new Date(row.original.expiresAt).toLocaleDateString()}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'role',
      header: 'Organization role',
      cell: ({ row }) => <Badge variant="outline">{row.original.role ?? 'member'}</Badge>,
    },
    ...(editable ? [{
      id: 'actions',
      header: '',
      cell: ({ row }: { row: { original: InvitationRow } }) => (
        <Button
          variant="ghost"
          size="sm"
          disabled={cancelInvite.isPending}
          onClick={() => cancelInvite.mutate(row.original.id)}
        >
          Cancel
        </Button>
      ),
    } satisfies ColumnDef<InvitationRow>] : []),
  ]

  const columns = (
    rows: MemberRow[],
    selected: string[],
    setSelected: (ids: string[]) => void,
  ): ColumnDef<MemberRow>[] => [
    ...(editable ? [{
      id: 'select',
      header: () => (
        <Checkbox
          aria-label="Select all members"
          checked={selected.length > 0 && selected.length === rows.length}
          onCheckedChange={(checked) =>
            setSelected(checked ? rows.map((row) => row.userId) : [])
          }
          disabled={bulk.isPending}
        />
      ),
      cell: ({ row }: { row: { original: MemberRow } }) => (
        <Checkbox
          aria-label={`Select ${row.original.name}`}
          checked={selected.includes(row.original.userId)}
          onCheckedChange={(checked) => setSelected(
            checked
              ? [...selected, row.original.userId]
              : selected.filter((id) => id !== row.original.userId),
          )}
          disabled={bulk.isPending}
        />
      ),
    } satisfies ColumnDef<MemberRow>] : []),
    {
      accessorKey: 'search',
      header: 'Member',
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <Avatar size="sm">
            <AvatarImage src={row.original.image ?? undefined} />
            <AvatarFallback>{row.original.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-2 font-medium">
              {row.original.name}
              {team?.leadUserId === row.original.userId && <Badge>Team lead</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">{row.original.email}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'organizationRole',
      header: 'Organization role',
      cell: ({ row }) => <Badge variant="secondary">{row.original.organizationRole}</Badge>,
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-xl font-semibold tracking-wide uppercase">{team?.name ?? 'Team'}</h1>
            {archived && <Badge variant="outline">Archived</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{team?.description || 'Manage this team and its members.'}</p>
        </div>
        {canManage && team && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setConfirmation(archived ? 'restore' : 'archive')}>
              <ArchiveIcon /> {archived ? 'Restore' : 'Archive'}
            </Button>
            {canDelete && (
              <Button variant="destructive" onClick={() => setConfirmation('delete')}>
                <Trash2Icon /> Delete
              </Button>
            )}
          </div>
        )}
      </div>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Team details</CardTitle>
            <CardDescription>{archived ? 'Restore this team to edit its details.' : 'Update its purpose and team lead.'}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="team-detail-name">Name</Label>
              <Input id="team-detail-name" value={name} disabled={!editable} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Team lead</Label>
              <Select value={leadUserId} disabled={!editable} onValueChange={(value) => setLeadUserId(String(value ?? ''))}>
                <SelectTrigger><SelectValue placeholder="No team lead" /></SelectTrigger>
                <SelectContent>
                  {organizationMembers.data?.members.map((member) => (
                    <SelectItem key={member.userId} value={member.userId}>{member.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="team-detail-description">Description</Label>
              <Input id="team-detail-description" value={description} disabled={!editable} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <Button disabled={!editable || !name || update.isPending} onClick={() => update.mutate()}>
              {update.isPending ? 'Saving…' : 'Save team'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Team members</CardTitle>
            <CardDescription>{assignedRows.length} assigned{archived ? ' · Archived teams are read-only' : ''}</CardDescription>
          </div>
          {editable && (
            <Button onClick={() => setInviteOpen(true)}>
              <MailPlusIcon /> Invite to team
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {editable && selectedAssigned.length > 0 && (
            <Button variant="destructive" disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'remove', userIds: selectedAssigned })}>
              Remove selected ({selectedAssigned.length})
            </Button>
          )}
          <DataTable
            columns={columns(assignedRows, selectedAssigned, setSelectedAssigned)}
            data={assignedRows}
            searchColumn="search"
            searchPlaceholder="Search assigned members…"
            emptyMessage={teamMembers.isPending ? 'Loading members…' : 'This team has no members.'}
          />
          {pendingInvitations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Pending invitations</h3>
              <DataTable
                columns={invitationColumns}
                data={pendingInvitations}
                searchColumn="search"
                searchPlaceholder="Search pending invitations…"
                emptyMessage="No pending invitations."
              />
            </div>
          )}
        </CardContent>
      </Card>

      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Add organization members</CardTitle>
            <CardDescription>Select active organization members to add to this team.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedAvailable.length > 0 && (
              <Button disabled={bulk.isPending} onClick={() => bulk.mutate({ action: 'add', userIds: selectedAvailable })}>
                Add selected ({selectedAvailable.length})
              </Button>
            )}
            <DataTable
              columns={columns(availableRows, selectedAvailable, setSelectedAvailable)}
              data={availableRows}
              searchColumn="search"
              searchPlaceholder="Search available members…"
              emptyMessage="No available organization members."
            />
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmation !== null} onOpenChange={(open) => !open && setConfirmation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmation === 'delete' ? 'Delete team?' : confirmation === 'archive' ? 'Archive team?' : 'Restore team?'}
            </DialogTitle>
            <DialogDescription>
              {confirmation === 'delete'
                ? 'This permanently deletes the team and removes all of its memberships. This action cannot be undone.'
                : confirmation === 'archive'
                  ? 'Members remain assigned, but the team becomes read-only until restored.'
                  : 'This makes the team editable again.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmation(null)}>Cancel</Button>
            <Button
              variant={confirmation === 'delete' ? 'destructive' : 'default'}
              disabled={lifecycle.isPending || confirmation === null}
              onClick={() => confirmation && lifecycle.mutate(confirmation)}
            >
              {lifecycle.isPending ? 'Working…' : confirmation === 'delete' ? 'Delete team' : confirmation === 'archive' ? 'Archive team' : 'Restore team'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite to {team?.name ?? 'team'}</DialogTitle>
            <DialogDescription>
              The user will join the organization and this team after accepting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="team-invite-email">Email</Label>
              <Input
                id="team-invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="member@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Organization role</Label>
              <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as 'admin' | 'member')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  {organization.role === 'owner' && <SelectItem value="admin">Admin</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button
              disabled={!inviteEmail.trim() || invite.isPending}
              onClick={() => invite.mutate()}
            >
              {invite.isPending ? 'Sending…' : 'Send invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
