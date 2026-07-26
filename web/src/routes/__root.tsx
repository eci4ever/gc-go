import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { Activity } from 'lucide-react'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <header className="flex h-16 items-center justify-between border-b">
          <Link to="/" className="group flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-transform group-hover:-rotate-3">
              <Activity className="size-4" />
            </span>
            <span className="font-heading text-sm font-semibold tracking-tight">
              Go Control
            </span>
          </Link>

          <nav className="flex items-center rounded-lg border p-1">
            <Link
              to="/"
              activeOptions={{ exact: true }}
              activeProps={{ className: 'bg-muted text-foreground shadow-xs' }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Overview
            </Link>
            <Link
              to="/about"
              activeProps={{ className: 'bg-muted text-foreground shadow-xs' }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              About
            </Link>
          </nav>
        </header>
        <Outlet />
      </div>
    </div>
  )
}
