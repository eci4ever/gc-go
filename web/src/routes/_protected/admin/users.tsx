import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  ArrowUpDownIcon,
  BanIcon,
  MoreHorizontalIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UserRoundCogIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { DataTable } from '@/components/data-table'
import { PageHeader } from '@/components/page-header'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  adminUsersQueryOptions,
  adminUsersKey,
  adminOrganizationsQueryOptions,
  bulkAdminUsers,
  createAdminUser,
  deleteAdminUser,
  impersonateAdminUser,
  restoreAdminUser,
  setAdminUserBan,
  updateAdminUser,
  type AdminUser,
  type AdminUserInput,
  type AdminOrganization,
} from '@/lib/admin'
import { sessionQueryOptions } from '@/lib/auth'

export const Route = createFileRoute('/_protected/admin/users')({
  component: AdminUsersPage,
})

function AdminUsersPage() {
  const { user: currentUser } = Route.useRouteContext()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const deferredSearch = useDeferredValue(search)
  const usersQuery = useQuery(
    adminUsersQueryOptions({
      page,
      pageSize: 20,
      search: deferredSearch,
      role: roleFilter === 'all' ? '' : roleFilter,
      status: statusFilter === 'all' ? '' : statusFilter,
      includeDeleted: true,
    }),
  )
  const organizationsQuery = useQuery(
    adminOrganizationsQueryOptions({ pageSize: 100 }),
  )
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const [editor, setEditor] = useState<AdminUser | 'new' | null>(null)
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)
  const [impersonateTarget, setImpersonateTarget] =
    useState<AdminUser | null>(null)
  const [selectedIDs, setSelectedIDs] = useState<string[]>([])
  const [bulkOpen, setBulkOpen] = useState(false)

  const refreshUsers = () =>
    queryClient.invalidateQueries({ queryKey: adminUsersKey })

  const saveMutation = useMutation({
    mutationFn: ({
      target,
      input,
    }: {
      target: AdminUser | 'new'
      input: AdminUserInput
    }) =>
      target === 'new'
        ? createAdminUser(input)
        : updateAdminUser(target.id, input),
    onSuccess: async (_, { target }) => {
      setEditor(null)
      await refreshUsers()
      toast.success(target === 'new' ? 'User created' : 'User updated')
    },
    onError: (error) => toast.error(error.message),
  })
  const banMutation = useMutation({
    mutationFn: ({
      user,
      reason,
      expiresAt,
    }: {
      user: AdminUser
      reason: string
      expiresAt: string
    }) =>
      setAdminUserBan(user.id, {
        banned: !user.banned,
        reason,
        expiresAt,
      }),
    onSuccess: async (_, { user }) => {
      setBanTarget(null)
      await refreshUsers()
      toast.success(user.banned ? 'User unbanned' : 'User banned')
    },
    onError: (error) => toast.error(error.message),
  })
  const deleteMutation = useMutation({
    mutationFn: (user: AdminUser) => deleteAdminUser(user.id),
    onSuccess: async () => {
      setDeleteTarget(null)
      await refreshUsers()
      toast.success('User deleted')
    },
    onError: (error) => toast.error(error.message),
  })
  const restoreMutation = useMutation({
    mutationFn: (user: AdminUser) => restoreAdminUser(user.id),
    onSuccess: async () => {
      await refreshUsers()
      toast.success('User restored')
    },
    onError: (error) => toast.error(error.message),
  })
  const bulkMutation = useMutation({
    mutationFn: bulkAdminUsers,
    onSuccess: async (result) => {
      setBulkOpen(false)
      setSelectedIDs([])
      await refreshUsers()
      toast.success(`${result.updated} users updated`)
    },
    onError: (error) => toast.error(error.message),
  })
  const impersonateMutation = useMutation({
    mutationFn: ({
      userId,
      reason,
      durationMinutes,
    }: {
      userId: string
      reason: string
      durationMinutes: number
    }) => impersonateAdminUser(userId, { reason, durationMinutes }),
    onSuccess: async (session) => {
      queryClient.setQueryData(sessionQueryOptions.queryKey, session)
      await navigate({ to: '/dashboard' })
      await router.invalidate()
      toast.success(`Now viewing as ${session.user?.email}`)
    },
    onError: (error) => toast.error(error.message),
  })

  const columns = useMemo<ColumnDef<AdminUser>[]>(
    () => [
      {
        id: 'select',
        header: () => {
          const pageIDs = (usersQuery.data?.users ?? []).map((user) => user.id)
          return (
            <Checkbox
              aria-label="Select page"
              checked={
                pageIDs.length > 0 &&
                pageIDs.every((id) => selectedIDs.includes(id))
              }
              onCheckedChange={(checked) =>
                setSelectedIDs((current) =>
                  checked
                    ? [...new Set([...current, ...pageIDs])]
                    : current.filter((id) => !pageIDs.includes(id)),
                )
              }
            />
          )
        },
        cell: ({ row }) => (
          <Checkbox
            aria-label={`Select ${row.original.name}`}
            checked={selectedIDs.includes(row.original.id)}
            onCheckedChange={(checked) =>
              setSelectedIDs((current) =>
                checked
                  ? [...current, row.original.id]
                  : current.filter((id) => id !== row.original.id),
              )
            }
          />
        ),
      },
      {
        accessorKey: 'email',
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            User
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => {
          const user = row.original
          const initials = user.name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase())
            .join('')
          return (
            <div className="flex items-center gap-3">
              <Avatar>
                {user.image ? (
                  <AvatarImage src={user.image} alt={user.name} />
                ) : null}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ row }) => (
          <Badge variant={row.original.role === 'admin' ? 'default' : 'secondary'}>
            {row.original.role === 'admin' ? <ShieldCheckIcon /> : null}
            {row.original.role}
          </Badge>
        ),
      },
      {
        accessorKey: 'banned',
        header: 'Status',
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.deletedAt || row.original.banned
                ? 'destructive'
                : 'secondary'
            }
          >
            {row.original.deletedAt
              ? 'Deleted'
              : row.original.banned
                ? 'Banned'
                : 'Active'}
          </Badge>
        ),
      },
      {
        accessorKey: 'activeSessions',
        header: 'Sessions',
      },
      {
        accessorKey: 'organizationCount',
        header: 'Organizations',
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        cell: ({ row }) =>
          new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
          }).format(new Date(row.original.createdAt)),
      },
      {
        id: 'actions',
        cell: ({ row }) => {
          const user = row.original
          const isSelf = user.id === currentUser.id
          if (user.deletedAt) {
            return (
              <Button
                variant="outline"
                size="sm"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate(user)}
              >
                Restore
              </Button>
            )
          }
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Manage ${user.name}`}
                  />
                }
              >
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditor(user)}>
                  <UserRoundCogIcon />
                  Edit user
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isSelf || user.banned}
                  onClick={() => setImpersonateTarget(user)}
                >
                  <UserRoundCogIcon />
                  Impersonate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isSelf}
                  onClick={() => setBanTarget(user)}
                >
                  <BanIcon />
                  {user.banned ? 'Unban user' : 'Ban user'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isSelf}
                  onClick={() => setDeleteTarget(user)}
                >
                  <Trash2Icon />
                  Delete user
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    [
      currentUser.id,
      impersonateMutation,
      restoreMutation,
      selectedIDs,
      usersQuery.data?.users,
    ],
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <PageHeader
        title="Users"
        description="Manage access, roles, account status, and user sessions."
        actions={
          <Button onClick={() => setEditor('new')}>
            <PlusIcon data-icon="inline-start" />
            Add User
          </Button>
        }
      />

      {selectedIDs.length ? (
        <div className="flex items-center justify-between border bg-muted/30 px-4 py-3">
          <p className="text-sm">{selectedIDs.length} users selected</p>
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            Bulk action
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Select
          value={roleFilter}
          onValueChange={(value) => {
            setRoleFilter(value ?? 'all')
            setPage(1)
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="user">Users</SelectItem>
            <SelectItem value="admin">Platform admins</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value ?? 'all')
            setPage(1)
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="banned">Banned</SelectItem>
            <SelectItem value="deleted">Deleted</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        loading={usersQuery.isPending}
        columns={columns}
        data={usersQuery.data?.users ?? []}
        searchColumn="email"
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        pagination={usersQuery.data?.pagination}
        onPageChange={setPage}
        searchPlaceholder="Search by email…"
        emptyMessage={
          usersQuery.isPending ? 'Loading users…' : 'No users found.'
        }
      />

      <UserEditorDialog
        target={editor}
        pending={saveMutation.isPending}
        onOpenChange={(open) => !open && setEditor(null)}
        onSubmit={(target, input) => saveMutation.mutate({ target, input })}
      />
      <BanUserDialog
        user={banTarget}
        pending={banMutation.isPending}
        onOpenChange={(open) => !open && setBanTarget(null)}
        onSubmit={(user, reason, expiresAt) =>
          banMutation.mutate({ user, reason, expiresAt })
        }
      />
      <ConfirmDeleteDialog
        user={deleteTarget}
        pending={deleteMutation.isPending}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={(user) => deleteMutation.mutate(user)}
      />
      <ImpersonationDialog
        user={impersonateTarget}
        pending={impersonateMutation.isPending}
        onOpenChange={(open) => !open && setImpersonateTarget(null)}
        onSubmit={(userId, reason, durationMinutes) =>
          impersonateMutation.mutate({ userId, reason, durationMinutes })
        }
      />
      <BulkUsersDialog
        open={bulkOpen}
        count={selectedIDs.length}
        organizations={organizationsQuery.data?.organizations ?? []}
        pending={bulkMutation.isPending}
        onOpenChange={setBulkOpen}
        onSubmit={(action, reason, organizationId) =>
          bulkMutation.mutate({
            action,
            userIds: selectedIDs,
            reason,
            organizationId,
          })
        }
      />
    </div>
  )
}

function UserEditorDialog({
  target,
  pending,
  onOpenChange,
  onSubmit,
}: {
  target: AdminUser | 'new' | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (target: AdminUser | 'new', input: AdminUserInput) => void
}) {
  const [role, setRole] = useState<'user' | 'admin'>('user')
  useEffect(() => {
    setRole(target && target !== 'new' ? target.role : 'user')
  }, [target])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!target) return
    const form = new FormData(event.currentTarget)
    onSubmit(target, {
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? ''),
      image: String(form.get('image') ?? ''),
      password: String(form.get('password') ?? '') || undefined,
      role,
      emailVerified: form.get('emailVerified') === 'on',
    })
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={onOpenChange}
    >
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {target === 'new' ? 'Create user' : 'Edit user'}
            </DialogTitle>
            <DialogDescription>
              {target === 'new'
                ? 'Create a credential account with an initial password.'
                : 'Update profile, verification status, and platform role.'}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-6 gap-5">
            <Field>
              <FieldLabel htmlFor="admin-user-name">Name</FieldLabel>
              <Input
                id="admin-user-name"
                name="name"
                defaultValue={target !== 'new' ? target?.name : ''}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="admin-user-email">Email</FieldLabel>
              <Input
                id="admin-user-email"
                name="email"
                type="email"
                defaultValue={target !== 'new' ? target?.email : ''}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="admin-user-image">Image URL</FieldLabel>
              <Input
                id="admin-user-image"
                name="image"
                type="url"
                defaultValue={target !== 'new' ? target?.image ?? '' : ''}
              />
            </Field>
            {target === 'new' ? (
              <Field>
                <FieldLabel htmlFor="admin-user-password">
                  Initial password
                </FieldLabel>
                <Input
                  id="admin-user-password"
                  name="password"
                  type="password"
                  minLength={8}
                  maxLength={72}
                  required
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel>Role</FieldLabel>
              <Select value={role} onValueChange={(value) => setRole(value as 'user' | 'admin')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Platform admin</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="admin-user-verified"
                name="emailVerified"
                defaultChecked={target !== 'new' && Boolean(target?.emailVerified)}
              />
              <FieldLabel htmlFor="admin-user-verified">
                Email is verified
              </FieldLabel>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BanUserDialog({
  user,
  pending,
  onOpenChange,
  onSubmit,
}: {
  user: AdminUser | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (user: AdminUser, reason: string, expiresAt: string) => void
}) {
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!user) return
            const form = new FormData(event.currentTarget)
            const expiry = String(form.get('expiresAt') ?? '')
            onSubmit(
              user,
              String(form.get('reason') ?? ''),
              expiry ? new Date(expiry).toISOString() : '',
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {user?.banned ? 'Unban user' : 'Ban user'}
            </DialogTitle>
            <DialogDescription>
              {user?.banned
                ? `Restore access for ${user.email}?`
                : `Ban ${user?.email} and revoke every active session.`}
            </DialogDescription>
          </DialogHeader>
          {!user?.banned ? (
            <FieldGroup className="my-6 gap-5">
              <Field>
                <FieldLabel htmlFor="ban-reason">Reason</FieldLabel>
                <Input id="ban-reason" name="reason" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="ban-expiry">
                  Expiry (optional)
                </FieldLabel>
                <Input
                  id="ban-expiry"
                  name="expiresAt"
                  type="datetime-local"
                />
                <FieldDescription>
                  Leave blank for an indefinite ban.
                </FieldDescription>
              </Field>
            </FieldGroup>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={user?.banned ? 'default' : 'destructive'}
              disabled={pending}
            >
              {pending ? 'Updating…' : user?.banned ? 'Unban user' : 'Ban user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmDeleteDialog({
  user,
  pending,
  onOpenChange,
  onConfirm,
}: {
  user: AdminUser | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (user: AdminUser) => void
}) {
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete user</DialogTitle>
          <DialogDescription>
            Soft-delete {user?.email} and revoke all sessions. The account can
            be restored later unless its email is reused.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!user || pending}
            onClick={() => user && onConfirm(user)}
          >
            {pending ? 'Deleting…' : 'Delete user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ImpersonationDialog({
  user,
  pending,
  onOpenChange,
  onSubmit,
}: {
  user: AdminUser | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (userId: string, reason: string, durationMinutes: number) => void
}) {
  const [duration, setDuration] = useState('30')
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!user) return
            const form = new FormData(event.currentTarget)
            onSubmit(
              user.id,
              String(form.get('reason') ?? ''),
              Number(duration),
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Impersonate {user?.name}</DialogTitle>
            <DialogDescription>
              This action is audited. Platform Admin access is disabled while
              impersonating.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-6 gap-5">
            <Field>
              <FieldLabel htmlFor="impersonation-reason">Reason</FieldLabel>
              <Input
                id="impersonation-reason"
                name="reason"
                placeholder="Investigating support ticket…"
                required
              />
            </Field>
            <Field>
              <FieldLabel>Duration</FieldLabel>
              <Select value={duration} onValueChange={(value) => setDuration(value ?? '30')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutes</SelectItem>
                  <SelectItem value="30">30 minutes</SelectItem>
                  <SelectItem value="60">60 minutes</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Starting…' : 'Start impersonation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BulkUsersDialog({
  open,
  count,
  organizations,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  count: number
  organizations: AdminOrganization[]
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (action: string, reason: string, organizationId: string) => void
}) {
  const [action, setAction] = useState('verify')
  const [organizationID, setOrganizationID] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            onSubmit(
              action,
              String(form.get('reason') ?? ''),
              organizationID,
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Bulk update {count} users</DialogTitle>
            <DialogDescription>
              All selected users are updated atomically. If one fails, no
              changes are applied.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-6 gap-5">
            <Field>
              <FieldLabel>Action</FieldLabel>
              <Select value={action} onValueChange={(value) => setAction(value ?? 'verify')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="verify">Verify email</SelectItem>
                  <SelectItem value="ban">Ban users</SelectItem>
                  <SelectItem value="unban">Unban users</SelectItem>
                  <SelectItem value="assign_organization">
                    Assign organization
                  </SelectItem>
                  <SelectItem value="delete">Soft delete</SelectItem>
                  <SelectItem value="restore">Restore</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {action === 'ban' ? (
              <Field>
                <FieldLabel htmlFor="bulk-reason">Reason</FieldLabel>
                <Input id="bulk-reason" name="reason" required />
              </Field>
            ) : null}
            {action === 'assign_organization' ? (
              <Field>
                <FieldLabel>Organization</FieldLabel>
                <Select
                  value={organizationID}
                  onValueChange={(value) => setOrganizationID(value ?? '')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizations
                      .filter((organization) => !organization.deletedAt)
                      .map((organization) => (
                        <SelectItem
                          key={organization.id}
                          value={organization.id}
                        >
                          {organization.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                (action === 'assign_organization' && !organizationID)
              }
            >
              {pending ? 'Updating…' : 'Apply bulk action'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
