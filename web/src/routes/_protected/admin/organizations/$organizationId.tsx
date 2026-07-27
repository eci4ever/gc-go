import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  MailPlusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  addOrganizationMember,
  adminOrganizationMembersQueryOptions,
  adminOrganizationsQueryOptions,
  adminUsersQueryOptions,
  cancelOrganizationInvitation,
  inviteOrganizationMember,
  removeOrganizationMember,
  updateOrganizationMember,
  type OrganizationMember,
} from '@/lib/admin'

export const Route = createFileRoute(
  '/_protected/admin/organizations/$organizationId',
)({
  component: OrganizationMembersPage,
})

function OrganizationMembersPage() {
  const { organizationId } = Route.useParams()
  const queryClient = useQueryClient()
  const organizationQuery = useQuery(
    adminOrganizationsQueryOptions({ pageSize: 100, includeDeleted: true }),
  )
  const membersQuery = useQuery(
    adminOrganizationMembersQueryOptions(organizationId),
  )
  const usersQuery = useQuery(adminUsersQueryOptions({ pageSize: 100 }))
  const organization = organizationQuery.data?.organizations.find(
    (item) => item.id === organizationId,
  )
  const [addOpen, setAddOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ['admin', 'organizations', organizationId, 'members'],
    })
  const memberMutation = useMutation({
    mutationFn: ({
      userId,
      role,
      mode,
    }: {
      userId: string
      role: 'admin' | 'member'
      mode: 'add' | 'update'
    }) =>
      mode === 'add'
        ? addOrganizationMember(organizationId, { userId, role })
        : updateOrganizationMember(organizationId, userId, role),
    onSuccess: async () => {
      setAddOpen(false)
      await refresh()
      toast.success('Organization member updated')
    },
    onError: (error) => toast.error(error.message),
  })
  const removeMutation = useMutation({
    mutationFn: (member: OrganizationMember) =>
      removeOrganizationMember(organizationId, member.userId),
    onSuccess: async () => {
      await refresh()
      toast.success('Member removed')
    },
    onError: (error) => toast.error(error.message),
  })
  const inviteMutation = useMutation({
    mutationFn: (input: { email: string; role: 'admin' | 'member' }) =>
      inviteOrganizationMember(organizationId, input),
    onSuccess: async () => {
      setInviteOpen(false)
      await refresh()
      toast.success('Invitation sent')
    },
    onError: (error) => toast.error(error.message),
  })
  const cancelInviteMutation = useMutation({
    mutationFn: (invitationId: string) =>
      cancelOrganizationInvitation(organizationId, invitationId),
    onSuccess: async () => {
      await refresh()
      toast.success('Invitation cancelled')
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            className="mb-3"
            render={<Link to="/admin/organizations" />}
          >
            <ArrowLeftIcon />
            Organizations
          </Button>
          <h1 className="font-heading text-xl font-semibold">
            {organization?.name ?? 'Organization members'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage roles, direct membership, and pending invitations.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setInviteOpen(true)}>
            <MailPlusIcon />
            Invite
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon />
            Add existing user
          </Button>
        </div>
      </div>

      <div className="border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(membersQuery.data?.members ?? []).map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      {member.image ? <AvatarImage src={member.image} /> : null}
                      <AvatarFallback>
                        {member.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{member.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {member.email}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                    {member.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  {member.deletedAt
                    ? 'Deleted'
                    : member.banned
                      ? 'Banned'
                      : 'Active'}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon-sm" />}
                    >
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={member.role === 'owner'}
                        onClick={() =>
                          memberMutation.mutate({
                            userId: member.userId,
                            role: member.role === 'admin' ? 'member' : 'admin',
                            mode: 'update',
                          })
                        }
                      >
                        Set as {member.role === 'admin' ? 'member' : 'admin'}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={member.role === 'owner'}
                        onClick={() => removeMutation.mutate(member)}
                      >
                        <Trash2Icon />
                        Remove member
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold">Invitations</h2>
        <div className="border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(membersQuery.data?.invitations ?? []).map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell>{invitation.email}</TableCell>
                  <TableCell>{invitation.role ?? 'member'}</TableCell>
                  <TableCell>{invitation.status}</TableCell>
                  <TableCell>
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: 'medium',
                    }).format(new Date(invitation.expiresAt))}
                  </TableCell>
                  <TableCell>
                    {invitation.status === 'pending' ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Cancel invitation"
                        onClick={() =>
                          cancelInviteMutation.mutate(invitation.id)
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <MemberDialog
        open={addOpen}
        users={usersQuery.data?.users ?? []}
        pending={memberMutation.isPending}
        onOpenChange={setAddOpen}
        onSubmit={(userId, role) =>
          memberMutation.mutate({ userId, role, mode: 'add' })
        }
      />
      <InviteDialog
        open={inviteOpen}
        pending={inviteMutation.isPending}
        onOpenChange={setInviteOpen}
        onSubmit={(email, role) => inviteMutation.mutate({ email, role })}
      />
    </div>
  )
}

function MemberDialog({
  open,
  users,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  users: { id: string; name: string; email: string; banned: boolean; deletedAt: string | null }[]
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (userId: string, role: 'admin' | 'member') => void
}) {
  const [userID, setUserID] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add existing user</DialogTitle>
          <DialogDescription>
            Add an active platform user directly to this organization.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="my-6 gap-5">
          <Field>
            <FieldLabel>User</FieldLabel>
            <Select value={userID} onValueChange={(value) => setUserID(value ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select user" />
              </SelectTrigger>
              <SelectContent>
                {users
                  .filter((user) => !user.banned && !user.deletedAt)
                  .map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name} — {user.email}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <RoleSelect role={role} onChange={setRole} />
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!userID || pending} onClick={() => onSubmit(userID, role)}>
            {pending ? 'Adding…' : 'Add member'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function InviteDialog({
  open,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (email: string, role: 'admin' | 'member') => void
}) {
  const [role, setRole] = useState<'admin' | 'member'>('member')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    onSubmit(String(form.get('email') ?? ''), role)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Send a secure invitation link that expires in seven days.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-6 gap-5">
            <Field>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input id="invite-email" name="email" type="email" required />
            </Field>
            <RoleSelect role={role} onChange={setRole} />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Sending…' : 'Send invitation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RoleSelect({
  role,
  onChange,
}: {
  role: 'admin' | 'member'
  onChange: (role: 'admin' | 'member') => void
}) {
  return (
    <Field>
      <FieldLabel>Organization role</FieldLabel>
      <Select value={role} onValueChange={(value) => onChange(value as 'admin' | 'member')}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="member">Member</SelectItem>
          <SelectItem value="admin">Organization admin</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  )
}
