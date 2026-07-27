import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  ArrowUpDownIcon,
  Building2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { DataTable } from '@/components/data-table'
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
import { Textarea } from '@/components/ui/textarea'
import {
  adminOrganizationsQueryOptions,
  adminOrganizationsKey,
  adminUsersQueryOptions,
  adminUsersKey,
  createAdminOrganization,
  deleteAdminOrganization,
  restoreAdminOrganization,
  updateAdminOrganization,
  type AdminOrganization,
  type AdminOrganizationInput,
  type AdminUser,
} from '@/lib/admin'

export const Route = createFileRoute('/_protected/admin/organizations')({
  component: AdminOrganizationsPage,
})

function AdminOrganizationsPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const organizationsQuery = useQuery(
    adminOrganizationsQueryOptions({
      page,
      pageSize: 20,
      search: deferredSearch,
      includeDeleted: true,
    }),
  )
  const usersQuery = useQuery(adminUsersQueryOptions({ pageSize: 100 }))
  const queryClient = useQueryClient()
  const [editor, setEditor] = useState<AdminOrganization | 'new' | null>(null)
  const [deleteTarget, setDeleteTarget] =
    useState<AdminOrganization | null>(null)

  const refreshOrganizations = () =>
    queryClient.invalidateQueries({
      queryKey: adminOrganizationsKey,
    })
  const saveMutation = useMutation({
    mutationFn: ({
      target,
      input,
    }: {
      target: AdminOrganization | 'new'
      input: AdminOrganizationInput
    }) =>
      target === 'new'
        ? createAdminOrganization(input)
        : updateAdminOrganization(target.id, input),
    onSuccess: async (_, { target }) => {
      setEditor(null)
      await Promise.all([
        refreshOrganizations(),
        queryClient.invalidateQueries({
          queryKey: adminUsersKey,
        }),
      ])
      toast.success(
        target === 'new'
          ? 'Organization created'
          : 'Organization updated',
      )
    },
    onError: (error) => toast.error(error.message),
  })
  const deleteMutation = useMutation({
    mutationFn: (organization: AdminOrganization) =>
      deleteAdminOrganization(organization.id),
    onSuccess: async () => {
      setDeleteTarget(null)
      await Promise.all([
        refreshOrganizations(),
        queryClient.invalidateQueries({
          queryKey: adminUsersKey,
        }),
      ])
      toast.success('Organization deleted')
    },
    onError: (error) => toast.error(error.message),
  })
  const restoreMutation = useMutation({
    mutationFn: (organization: AdminOrganization) =>
      restoreAdminOrganization(organization.id),
    onSuccess: async () => {
      await refreshOrganizations()
      toast.success('Organization restored')
    },
    onError: (error) => toast.error(error.message),
  })

  const columns = useMemo<ColumnDef<AdminOrganization>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Organization
            <ArrowUpDownIcon />
          </Button>
        ),
        cell: ({ row }) => {
          const organization = row.original
          return (
            <div className="flex items-center gap-3">
              <Avatar>
                {organization.logo ? (
                  <AvatarImage
                    src={organization.logo}
                    alt={organization.name}
                  />
                ) : null}
                <AvatarFallback>
                  {organization.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{organization.name}</p>
                  {organization.deletedAt ? (
                    <Badge variant="destructive">Deleted</Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  /{organization.slug}
                </p>
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: 'ownerName',
        header: 'Owner',
        cell: ({ row }) =>
          row.original.ownerName ? (
            <div>
              <p>{row.original.ownerName}</p>
              <p className="text-xs text-muted-foreground">
                {row.original.ownerEmail}
              </p>
            </div>
          ) : (
            <Badge variant="destructive">No owner</Badge>
          ),
      },
      {
        accessorKey: 'memberCount',
        header: 'Members',
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
        cell: ({ row }) =>
          row.original.deletedAt ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => restoreMutation.mutate(row.original)}
            >
              Restore
            </Button>
          ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Manage ${row.original.name}`}
                />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                render={
                  <Link
                    to="/admin/organizations/$organizationId"
                    params={{ organizationId: row.original.id }}
                  />
                }
              >
                <UsersIcon />
                Manage members
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditor(row.original)}>
                <PencilIcon />
                Edit organization
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteTarget(row.original)}
              >
                <Trash2Icon />
                Delete organization
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          ),
      },
    ],
    [restoreMutation],
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-xl font-semibold">
            Organizations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage workspaces, ownership, identity, and membership totals.
          </p>
        </div>
        <Button onClick={() => setEditor('new')}>
          <PlusIcon />
          Add organization
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={organizationsQuery.data?.organizations ?? []}
        searchColumn="name"
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        pagination={organizationsQuery.data?.pagination}
        onPageChange={setPage}
        searchPlaceholder="Search organizations…"
        emptyMessage={
          organizationsQuery.isPending
            ? 'Loading organizations…'
            : 'No organizations found.'
        }
      />

      <OrganizationEditorDialog
        target={editor}
        users={usersQuery.data?.users ?? []}
        pending={saveMutation.isPending}
        onOpenChange={(open) => !open && setEditor(null)}
        onSubmit={(target, input) => saveMutation.mutate({ target, input })}
      />
      <DeleteOrganizationDialog
        organization={deleteTarget}
        pending={deleteMutation.isPending}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={(organization) => deleteMutation.mutate(organization)}
      />
    </div>
  )
}

function OrganizationEditorDialog({
  target,
  users,
  pending,
  onOpenChange,
  onSubmit,
}: {
  target: AdminOrganization | 'new' | null
  users: AdminUser[]
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (
    target: AdminOrganization | 'new',
    input: AdminOrganizationInput,
  ) => void
}) {
  const [ownerID, setOwnerID] = useState('')
  useEffect(() => {
    setOwnerID(target && target !== 'new' ? target.ownerId ?? '' : '')
  }, [target])
  const activeUsers = users.filter((user) => !user.banned)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!target) return
    const form = new FormData(event.currentTarget)
    onSubmit(target, {
      name: String(form.get('name') ?? ''),
      slug: String(form.get('slug') ?? ''),
      logo: String(form.get('logo') ?? ''),
      metadata: String(form.get('metadata') ?? ''),
      ownerId: ownerID,
    })
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {target === 'new'
                ? 'Create organization'
                : 'Edit organization'}
            </DialogTitle>
            <DialogDescription>
              Configure the organization identity and assign one active owner.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-6 gap-5">
            <Field>
              <FieldLabel htmlFor="organization-name">Name</FieldLabel>
              <Input
                id="organization-name"
                name="name"
                defaultValue={target !== 'new' ? target?.name : ''}
                maxLength={100}
                required
              />
            </Field>
            {target === 'new' ? (
              <Field>
                <FieldLabel>Slug</FieldLabel>
                <FieldDescription>
                  Generated automatically from the organization name.
                </FieldDescription>
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="organization-slug">Slug</FieldLabel>
                <Input
                  id="organization-slug"
                  name="slug"
                  defaultValue={target?.slug}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  required
                />
                <FieldDescription>
                  Changing this also changes the organization URL.
                </FieldDescription>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="organization-logo">Logo URL</FieldLabel>
              <Input
                id="organization-logo"
                name="logo"
                type="url"
                defaultValue={target !== 'new' ? target?.logo ?? '' : ''}
              />
            </Field>
            <Field>
              <FieldLabel>Owner</FieldLabel>
              <Select value={ownerID} onValueChange={(value) => setOwnerID(value ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select an owner" />
                </SelectTrigger>
                <SelectContent>
                  {activeUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name} — {user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="organization-metadata">
                Metadata JSON
              </FieldLabel>
              <Textarea
                id="organization-metadata"
                name="metadata"
                defaultValue={target !== 'new' ? target?.metadata ?? '' : ''}
                placeholder='{"plan":"pro"}'
              />
              <FieldDescription>
                Optional application metadata stored as valid JSON.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !ownerID}>
              {pending ? 'Saving…' : 'Save organization'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteOrganizationDialog({
  organization,
  pending,
  onOpenChange,
  onConfirm,
}: {
  organization: AdminOrganization | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (organization: AdminOrganization) => void
}) {
  return (
    <Dialog open={organization !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-2 grid size-10 place-items-center bg-destructive/10 text-destructive">
            <Building2Icon className="size-5" />
          </div>
          <DialogTitle>Delete organization</DialogTitle>
          <DialogDescription>
            Soft-delete {organization?.name}. Existing data is preserved and
            the organization can be restored later.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!organization || pending}
            onClick={() => organization && onConfirm(organization)}
          >
            {pending ? 'Deleting…' : 'Delete organization'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
