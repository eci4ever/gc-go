import { createFileRoute } from '@tanstack/react-router'
import { TeamDetails } from './-team-details'

const teamTabs = ['members', 'activity', 'settings'] as const

export const Route = createFileRoute(
  '/_protected/organizations/$organizationSlug/teams/$teamId',
)({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: teamTabs.includes(search.tab as (typeof teamTabs)[number])
      ? (search.tab as (typeof teamTabs)[number])
      : 'members',
  }),
  component: TeamDetails,
})
