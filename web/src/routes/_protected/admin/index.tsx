import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Building2Icon,
  MailIcon,
  MonitorSmartphoneIcon,
  ShieldAlertIcon,
  UserCheckIcon,
  UsersIcon,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { adminDashboardQueryOptions } from '@/lib/admin'

export const Route = createFileRoute('/_protected/admin/')({
  component: PlatformAdminOverview,
})

function PlatformAdminOverview() {
  const dashboard = useQuery(adminDashboardQueryOptions)
  const data = dashboard.data
  const cards = [
    { label: 'Total users', value: data?.totalUsers, icon: UsersIcon },
    {
      label: 'Verified users',
      value: data?.verifiedUsers,
      icon: UserCheckIcon,
    },
    {
      label: 'Banned users',
      value: data?.bannedUsers,
      icon: ShieldAlertIcon,
    },
    {
      label: 'Organizations',
      value: data?.totalOrganizations,
      icon: Building2Icon,
    },
    {
      label: 'Active sessions',
      value: data?.activeSessions,
      icon: MonitorSmartphoneIcon,
    },
    {
      label: 'Pending invites',
      value: data?.pendingInvitations,
      icon: MailIcon,
    },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 pt-0">
      <div>
        <h1 className="font-heading text-xl font-semibold">
          Platform overview
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Account, organization, and access activity across the platform.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="flex-row items-center justify-between">
              <CardDescription>{card.label}</CardDescription>
              <card.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">
                {dashboard.isPending ? '—' : (card.value ?? 0)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>New users</CardTitle>
          <CardDescription>
            Daily account creation over the last 30 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{ users: { label: 'New users', color: 'var(--primary)' } }}
            className="h-72 w-full"
          >
            <AreaChart data={data?.userGrowth ?? []} accessibilityLayer>
              <defs>
                <linearGradient id="admin-user-growth" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-users)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--color-users)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                minTickGap={28}
                tickFormatter={(value) =>
                  new Intl.DateTimeFormat(undefined, {
                    month: 'short',
                    day: 'numeric',
                  }).format(new Date(`${value}T00:00:00`))
                }
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                dataKey="users"
                type="monotone"
                fill="url(#admin-user-growth)"
                stroke="var(--color-users)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}
