import { useState, type ReactNode } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import type { Pagination } from '@/lib/admin'

export function DataTable<TData>({
  columns,
  data,
  searchColumn,
  searchPlaceholder = 'Search…',
  emptyMessage = 'No results.',
  searchValue,
  onSearchChange,
  pagination,
  onPageChange,
  toolbarActions,
  loading = false,
}: {
  columns: ColumnDef<TData>[]
  data: TData[]
  searchColumn: string
  searchPlaceholder?: string
  emptyMessage?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  pagination?: Pagination
  onPageChange?: (page: number) => void
  toolbarActions?: ReactNode
  loading?: boolean
}) {
  const [sorting, setSorting] = useState<SortingState>([])
  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
  })
  const currentSearch =
    searchValue ??
    ((table.getColumn(searchColumn)?.getFilterValue() as string) ?? '')

  function updateSearch(value: string) {
    if (onSearchChange) {
      onSearchChange(value)
    } else {
      table.getColumn(searchColumn)?.setFilterValue(value)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <InputGroup className="max-w-sm">
          <InputGroupInput
            aria-label={searchPlaceholder}
            name="table-search"
            autoComplete="off"
            placeholder={searchPlaceholder}
            value={currentSearch}
            onChange={(event) => updateSearch(event.target.value)}
          />
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          {currentSearch ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => updateSearch('')}
              >
                <XIcon aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        {toolbarActions ? (
          <div className="flex flex-wrap items-center gap-2">
            {toolbarActions}
          </div>
        ) : null}
      </div>
      <div className="border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }, (_, rowIndex) => (
                <TableRow key={`loading-${rowIndex}`}>
                  {columns.map((_, columnIndex) => (
                    <TableCell key={`loading-${rowIndex}-${columnIndex}`}>
                      <Skeleton className="h-4 w-full max-w-36" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {pagination?.total ?? table.getFilteredRowModel().rows.length} result
          {(pagination?.total ?? table.getFilteredRowModel().rows.length) === 1
            ? ''
            : 's'}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={
              pagination ? pagination.page <= 1 : !table.getCanPreviousPage()
            }
            onClick={() =>
              pagination && onPageChange
                ? onPageChange(pagination.page - 1)
                : table.previousPage()
            }
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {pagination?.page ?? table.getState().pagination.pageIndex + 1}{' '}
            of{' '}
            {pagination
              ? Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)
              : Math.max(table.getPageCount(), 1)}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={
              pagination
                ? pagination.page * pagination.pageSize >= pagination.total
                : !table.getCanNextPage()
            }
            onClick={() =>
              pagination && onPageChange
                ? onPageChange(pagination.page + 1)
                : table.nextPage()
            }
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  )
}
