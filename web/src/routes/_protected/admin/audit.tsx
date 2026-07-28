import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { EyeIcon } from 'lucide-react'

import { DataTable } from '@/components/data-table'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  adminAuditQueryOptions,
  type AdminAuditEvent,
} from '@/lib/admin'

export const Route = createFileRoute('/_protected/admin/audit')({
  component: AuditLogPage,
})

function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AdminAuditEvent | null>(null)
  const deferredSearch = useDeferredValue(search)
  const audit = useQuery(
    adminAuditQueryOptions({
      page,
      pageSize: 20,
      search: deferredSearch,
    }),
  )
  const columns = useMemo<ColumnDef<AdminAuditEvent>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        header: 'Time',
        cell: ({ row }) =>
          new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(row.original.createdAt)),
      },
      {
        accessorKey: 'actorEmail',
        header: 'Actor',
        cell: ({ row }) => (
          <div>
            <p>{row.original.actorName}</p>
            <p className="text-xs text-muted-foreground">
              {row.original.actorEmail}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'eventType',
        header: 'Event',
        cell: ({ row }) => (
          <Badge variant="secondary">
            {row.original.eventType.replaceAll('_', ' ')}
          </Badge>
        ),
      },
      {
        accessorKey: 'targetType',
        header: 'Target',
        cell: ({ row }) =>
          row.original.targetType ? (
            <div>
              <p className="capitalize">{row.original.targetType}</p>
              <p className="max-w-36 truncate text-xs text-muted-foreground">
                {row.original.targetId}
              </p>
            </div>
          ) : (
            '—'
          ),
      },
      {
        accessorKey: 'ipAddress',
        header: 'IP',
        cell: ({ row }) => row.original.ipAddress ?? '—',
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="View audit details"
            onClick={() => setSelected(row.original)}
          >
            <EyeIcon />
          </Button>
        ),
      },
    ],
    [],
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <PageHeader
        title="Audit Log"
        description="Trace administrative actions, targets, reasons, and state changes."
      />
      <DataTable
        loading={audit.isPending}
        columns={columns}
        data={audit.data?.events ?? []}
        searchColumn="eventType"
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        pagination={audit.data?.pagination}
        onPageChange={setPage}
        searchPlaceholder="Search actor, event, or target…"
        emptyMessage={audit.isPending ? 'Loading audit log…' : 'No events found.'}
      />
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Audit event details</DialogTitle>
            <DialogDescription>
              {selected?.eventType.replaceAll('_', ' ')}
              {selected?.reason ? ` — ${selected.reason}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <AuditState title="Before" value={selected?.beforeState} />
            <AuditState title="After" value={selected?.afterState} />
          </div>
          <div className="text-xs text-muted-foreground">
            <p>IP: {selected?.ipAddress ?? 'Unknown'}</p>
            <p className="break-all">User agent: {selected?.userAgent ?? 'Unknown'}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AuditState({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider">
        {title}
      </p>
      <pre className="max-h-72 overflow-auto border bg-muted/40 p-3 text-xs">
        {value ? JSON.stringify(value, null, 2) : 'No snapshot'}
      </pre>
    </div>
  )
}
