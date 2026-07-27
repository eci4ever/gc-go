import { useEffect, useMemo, useState, type FormEvent } from 'react'
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
  createAdminUser,
  deleteAdminUser,
  impersonateAdminUser,
  setAdminUserBan,
  updateAdminUser,
  type AdminUser,
  type AdminUserInput,
} from '@/lib/admin'
import { sessionQueryOptions } from '@/lib/auth'

export const Route = createFileRoute('/_protected/admin/users')({
  component: AdminUsersPage,
})

function AdminUsersPage() {
  const { user: currentUser } = Route.useRouteContext()
  const usersQuery = useQuery(adminUsersQueryOptions)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const [editor, setEditor] = useState<AdminUser | 'new' | null>(null)
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null)

  const refreshUsers = () =>
    queryClient.invalidateQueries({ queryKey: adminUsersQueryOptions.queryKey })

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
  const impersonateMutation = useMutation({
    mutationFn: impersonateAdminUser,
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
          <Badge variant={row.original.banned ? 'destructive' : 'secondary'}>
            {row.original.banned ? 'Banned' : 'Active'}
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
                  onClick={() => impersonateMutation.mutate(user.id)}
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
    [currentUser.id, impersonateMutation],
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-semibold">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage access, roles, account status, and user sessions.
          </p>
        </div>
        <Button onClick={() => setEditor('new')}>
          <PlusIcon />
          Add user
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={usersQuery.data?.users ?? []}
        searchColumn="email"
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
            Permanently delete {user?.email} and all related sessions,
            memberships, and credentials. This cannot be undone.
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
