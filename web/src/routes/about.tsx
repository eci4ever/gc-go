import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  Braces,
  Check,
  Database,
  Layers3,
  Server,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SiteHeader } from '@/components/site-header'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export const Route = createFileRoute('/about')({
  component: About,
})

const stack = [
  {
    label: 'Interface',
    title: 'React + TanStack',
    description:
      'File-based routes and cached server state keep navigation fast and predictable.',
    icon: Braces,
    items: ['React 19', 'TanStack Router', 'TanStack Query'],
  },
  {
    label: 'Service',
    title: 'Go + Fiber',
    description:
      'A small HTTP surface with explicit health signals and a simple deployment footprint.',
    icon: Server,
    items: ['Go 1.26', 'Fiber v3', 'systemd'],
  },
  {
    label: 'Data',
    title: 'PostgreSQL + sqlc',
    description:
      'Type-safe queries and a measured connection path make database health visible.',
    icon: Database,
    items: ['PostgreSQL', 'pgx v5', 'sqlc'],
  },
]

function About() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <section className="max-w-2xl">
        <Badge variant="outline">
          <Layers3 data-icon="inline-start" />
          About this stack
        </Badge>
        <h1 className="mt-5 font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          Small surface.
          <span className="text-muted-foreground"> Serious signals.</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
          Go Control is a focused status surface for the React frontend, Go API,
          and PostgreSQL database behind this application.
        </p>
      </section>

      <Separator className="my-9" />

      <section className="grid gap-4 md:grid-cols-3">
        {stack.map(({ label, title, description, icon: Icon, items }) => (
          <Card key={title} className="h-full">
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{label}</CardDescription>
              <CardAction>
                <span className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <p className="text-xs leading-5 text-muted-foreground">
                {description}
              </p>
              <ul className="mt-5 space-y-2">
                {items.map((item) => (
                  <li
                    key={item}
                    className="flex items-center gap-2 text-xs font-medium"
                  >
                    <span className="grid size-4 place-items-center rounded-full bg-primary/10 text-primary">
                      <Check className="size-2.5" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="mt-4 bg-primary text-primary-foreground">
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-heading text-base font-medium">
              Calm by default. Useful on demand.
            </p>
            <p className="mt-1 max-w-lg text-xs leading-5 text-primary-foreground/70">
              The interface prioritizes the signals that matter and stays out
              of the way when everything is healthy.
            </p>
          </div>
          <Button
            variant="secondary"
            size="lg"
            render={<Link to="/" />}
            className="shrink-0"
          >
            <ArrowLeft data-icon="inline-start" />
            Back to overview
          </Button>
        </CardContent>
      </Card>
      </main>
    </div>
  )
}
