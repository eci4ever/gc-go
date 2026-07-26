import { Link } from '@tanstack/react-router'
import { Activity } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="group flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-transform group-hover:-rotate-3">
            <Activity className="size-4" />
          </span>
          <span className="font-heading text-sm font-semibold tracking-tight">
            Go Control
          </span>
        </Link>

        <div className="flex items-center gap-1">
          <nav className="mr-1 hidden items-center rounded-lg border p-1 sm:flex">
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
          <Button variant="ghost" render={<Link to="/login" />}>
            Log in
          </Button>
          <Button render={<Link to="/signup" />}>Sign up</Button>
        </div>
      </div>
    </header>
  )
}
