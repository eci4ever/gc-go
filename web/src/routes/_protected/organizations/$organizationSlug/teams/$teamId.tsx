import { createFileRoute } from '@tanstack/react-router'
import { TeamDetails } from './-team-details'

export const Route = createFileRoute(
  '/_protected/organizations/$organizationSlug/teams/$teamId',
)({ component: TeamDetails })
