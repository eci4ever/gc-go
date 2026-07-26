import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Activity,
  ArrowRight,
  Check,
  CircleAlert,
  Clock3,
  Database,
  RefreshCw,
  Server,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: Home,
})

type Health = {
  status: string
  api: string
  db: string
  db_latency_ms: number | null
  time: string
}

type StatusState = 'online' | 'error' | 'pending'

function Home() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<Health> => {
      const response = await fetch('/api/health')
      if (!response.ok) throw new Error('API request failed')
      return response.json()
    },
    refetchInterval: 30_000,
  })

  const systemOnline = health.data?.status === 'ok'
  const latency = health.data?.db_latency_ms

  return (
    <main className="py-10 sm:py-14">
      <section className="grid items-center gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="max-w-2xl">
          <Badge
            variant="secondary"
          >
            <span className="size-1.5 rounded-full bg-primary" />
            Live system overview
          </Badge>
          <h1 className="mt-5 max-w-xl font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
            Infrastructure status,
            <span className="text-muted-foreground"> without the noise.</span>
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
            A focused view of the API and PostgreSQL connection powering this
            application.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              render={<Link to="/about" />}
            >
              Explore the stack
              <ArrowRight data-icon="inline-end" />
            </Button>
            <span className="text-xs text-muted-foreground">
              Refreshes automatically every 30 seconds
            </span>
          </div>
        </div>

        <Card className="hidden lg:flex">
          <CardHeader>
            <CardTitle>Current snapshot</CardTitle>
            <CardDescription>Latest service check</CardDescription>
            <CardAction>
              <span
                className={cn(
                  'grid size-8 place-items-center rounded-full',
                  systemOnline
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {systemOnline ? (
                  <Check className="size-4" />
                ) : (
                  <CircleAlert className="size-4" />
                )}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>
            {health.isPending ? (
              <div className="space-y-2">
                <Skeleton className="h-7 w-28" />
                <Skeleton className="h-3 w-40" />
              </div>
            ) : (
              <>
                <p className="font-heading text-2xl font-semibold tracking-tight">
                  {health.isError
                    ? 'Unavailable'
                    : systemOnline
                      ? 'All clear'
                      : 'Degraded'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {health.data
                    ? new Date(health.data.time).toLocaleString()
                    : 'Waiting for a successful check'}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-10 grid gap-4 md:grid-cols-3" aria-label="System status">
        <StatusCard
          label="API service"
          value={
            health.isPending
              ? 'Checking'
              : health.isError
                ? 'Offline'
                : health.data?.api === 'ok'
                  ? 'Operational'
                  : 'Degraded'
          }
          detail={
            health.isError
              ? 'The API did not respond'
              : 'Fiber is accepting requests'
          }
          state={
            health.isError
              ? 'error'
              : health.data?.api === 'ok'
                ? 'online'
                : 'pending'
          }
          icon={Server}
          pending={health.isPending}
        />
        <StatusCard
          label="PostgreSQL"
          value={
            health.isPending
              ? 'Checking'
              : health.isError
                ? 'Unknown'
                : health.data?.db === 'ok'
                  ? 'Connected'
                  : 'Unavailable'
          }
          detail={
            health.isError
              ? 'Waiting for the API'
              : health.data?.db === 'ok'
                ? 'Connection pool is healthy'
                : 'Database needs attention'
          }
          state={
            health.data?.db === 'ok'
              ? 'online'
              : health.isError
                ? 'pending'
                : 'error'
          }
          icon={Database}
          pending={health.isPending}
        />
        <StatusCard
          label="Database latency"
          value={
            latency != null
              ? `${latency.toFixed(1)} ms`
              : health.isPending
                ? 'Checking'
                : '—'
          }
          detail={
            latency == null
              ? 'No measurement available'
              : latency < 100
                ? 'Excellent response time'
                : latency < 500
                  ? 'Normal response time'
                  : 'Slower than usual'
          }
          state={latency != null ? 'online' : 'pending'}
          icon={Clock3}
          pending={health.isPending}
        />
      </section>

      <Card className="mt-4 bg-muted/40 shadow-none">
        <CardFooter className="gap-3">
          <span
            className={cn(
              'grid size-7 place-items-center rounded-full',
              systemOnline
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {health.isPending ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : systemOnline ? (
              <Activity className="size-3.5" />
            ) : (
              <CircleAlert className="size-3.5" />
            )}
          </span>
          <div>
            <p className="text-xs font-medium">
              {health.isPending
                ? 'Refreshing system status'
                : health.isError
                  ? 'System status unavailable'
                  : systemOnline
                    ? 'All systems operational'
                    : 'Some systems need attention'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {health.data
                ? `Last checked ${new Date(health.data.time).toLocaleString()}`
                : 'The next check will run automatically'}
            </p>
          </div>
          <Badge variant="secondary" className="ml-auto max-sm:hidden">
            <RefreshCw data-icon="inline-start" />
            30s interval
          </Badge>
        </CardFooter>
      </Card>
    </main>
  )
}

type Icon = typeof Server

type StatusCardProps = {
  label: string
  value: string
  detail: string
  state: StatusState
  icon: Icon
  pending: boolean
}

function StatusCard({
  label,
  value,
  detail,
  state,
  icon: Icon,
  pending,
}: StatusCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs text-muted-foreground">{label}</CardTitle>
        <CardAction>
          <span
            className={cn(
              'grid size-8 place-items-center rounded-md',
              state === 'online' && 'bg-primary/10 text-primary',
              state === 'error' && 'bg-destructive/10 text-destructive',
              state === 'pending' && 'bg-muted text-muted-foreground',
            )}
          >
            <Icon className="size-4" />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent>
        {pending ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'size-2 rounded-full',
                  state === 'online' && 'bg-primary',
                  state === 'error' && 'bg-destructive',
                  state === 'pending' && 'bg-muted-foreground/50',
                )}
              />
              <p className="font-heading text-xl font-semibold tracking-tight">
                {value}
              </p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
