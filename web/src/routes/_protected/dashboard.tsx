import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ActivityIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  LaptopIcon,
  MailCheckIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts'

import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { dashboardQueryOptions } from '@/lib/dashboard'
import type { ManagedSession } from '@/lib/auth'

export const Route = createFileRoute('/_protected/dashboard')({
  component: Dashboard,
})

const chartConfig = {
  signIns: {
    label: 'Sign-ins',
    color: 'var(--primary)',
  },
} satisfies ChartConfig

function Dashboard() {
  const { user } = Route.useRouteContext()
  const dashboard = useQuery(dashboardQueryOptions)
  const summary = dashboard.data

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <PageHeader
        title={`Welcome, ${user.name}`}
        description="A quick view of your account and recent security activity."
        actions={
          <Button variant="outline" render={<Link to="/account" />}>
            Manage Account
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        }
      />

      {dashboard.error && (
        <Card>
          <CardContent className="text-sm text-destructive">
            {dashboard.error.message}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={ShieldCheckIcon}
          label="Security score"
          value={summary ? `${summary.securityScore}%` : '—'}
          description={
            summary?.securityScore === 100
              ? 'All protections enabled'
              : 'Security can be improved'
          }
        >
          <div className="mt-3 h-1.5 bg-muted">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${summary?.securityScore ?? 0}%` }}
            />
          </div>
        </MetricCard>
        <MetricCard
          icon={LaptopIcon}
          label="Active sessions"
          value={summary ? String(summary.activeSessions) : '—'}
          description="Devices currently signed in"
        />
        <MetricCard
          icon={KeyRoundIcon}
          label="Two-factor auth"
          value={summary?.twoFactorEnabled ? 'Enabled' : 'Disabled'}
          description="Authenticator protection"
          badge={summary?.twoFactorEnabled ? 'Protected' : 'Action needed'}
        />
        <MetricCard
          icon={MailCheckIcon}
          label="Email"
          value={summary?.emailVerified ? 'Verified' : 'Unverified'}
          description={user.email}
          badge={summary?.emailVerified ? 'Verified' : 'Action needed'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Sign-in activity</CardTitle>
            <CardDescription>
              Successful account sign-ins over the last 14 days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={chartConfig}
              className="h-64 w-full aspect-auto"
            >
              <AreaChart
                data={summary?.signInActivity ?? []}
                accessibilityLayer
                margin={{ left: -20, right: 8 }}
              >
                <defs>
                  <linearGradient id="signInFill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-signIns)"
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-signIns)"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                  tickFormatter={formatChartDate}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) =>
                        formatLongDate(String(value))
                      }
                    />
                  }
                />
                <Area
                  dataKey="signIns"
                  type="monotone"
                  fill="url(#signInFill)"
                  fillOpacity={1}
                  stroke="var(--color-signIns)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security recommendations</CardTitle>
            <CardDescription>
              Complete these steps to strengthen your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Recommendation
              complete={summary?.emailVerified ?? false}
              title="Verify your email"
            />
            <Recommendation
              complete={summary?.twoFactorEnabled ?? false}
              title="Enable two-factor authentication"
            />
            <Recommendation
              complete={(summary?.activeSessions ?? 0) <= 1}
              title="Review active sessions"
            />
            <Button
              variant="ghost"
              className="mt-2 w-full justify-between"
              render={<Link to="/account" />}
            >
              Open security settings
              <ArrowRightIcon />
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>Recent sessions</CardTitle>
            <CardDescription>
              The latest devices with access to your account.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" render={<Link to="/account" />}>
            View all
          </Button>
        </CardHeader>
        <CardContent>
          {summary?.recentSessions.length ? (
            <div className="divide-y">
              {summary.recentSessions.map((session) => (
                <RecentSession key={session.id} session={session} />
              ))}
            </div>
          ) : (
            <Empty className="p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LaptopIcon />
                </EmptyMedia>
                <EmptyTitle>No Active Sessions</EmptyTitle>
                <EmptyDescription>
                  Recent devices will appear here after you sign in.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  description,
  badge,
  children,
}: {
  icon: typeof ActivityIcon
  label: string
  value: string
  description: string
  badge?: string
  children?: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <Icon className="size-4 text-muted-foreground" />
          {badge && <Badge variant="secondary">{badge}</Badge>}
        </div>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
        {children}
      </CardHeader>
    </Card>
  )
}

function Recommendation({
  complete,
  title,
}: {
  complete: boolean
  title: string
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        className={
          complete
            ? 'flex size-7 items-center justify-center bg-primary text-primary-foreground'
            : 'flex size-7 items-center justify-center bg-muted text-muted-foreground'
        }
      >
        {complete ? <CheckCircle2Icon /> : <ActivityIcon />}
      </span>
      <span className={complete ? 'text-muted-foreground line-through' : ''}>
        {title}
      </span>
    </div>
  )
}

function RecentSession({ session }: { session: ManagedSession }) {
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="flex size-9 items-center justify-center bg-muted">
        <LaptopIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">
            {session.userAgent || 'Unknown device'}
          </p>
          {session.current && <Badge>Current</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {session.ipAddress || 'Unknown IP'} ·{' '}
          {formatLongDate(session.createdAt)}
        </p>
      </div>
    </div>
  )
}

function formatChartDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`))
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: value.includes('T') ? 'short' : undefined,
  }).format(new Date(value.includes('T') ? value : `${value}T00:00:00Z`))
}
