import { useState } from 'react'
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
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

  return (
    <div className="flex flex-col gap-4">
      <Input
        className="max-w-sm"
        aria-label={searchPlaceholder}
        name="table-search"
        autoComplete="off"
        placeholder={searchPlaceholder}
        value={
          searchValue ??
          ((table.getColumn(searchColumn)?.getFilterValue() as string) ?? '')
        }
        onChange={(event) => {
          if (onSearchChange) {
            onSearchChange(event.target.value)
          } else {
            table
              .getColumn(searchColumn)
              ?.setFilterValue(event.target.value)
          }
        }}
      />
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
            {table.getRowModel().rows.length ? (
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
