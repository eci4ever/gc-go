import { queryOptions } from '@tanstack/react-query'
import { AuthError } from '@/lib/auth'

export type OrganizationRole = 'owner' | 'admin' | 'member'

export type OrganizationSummary = {
  id: string
  name: string
  slug: string
  logo: string | null
  metadata: string | null
  role: OrganizationRole
  createdAt: string
  updatedAt: string
}

export type OrganizationMembership = OrganizationSummary & {
  memberSince: string
}

export type OrganizationMember = {
  id: string
  role: OrganizationRole
  createdAt: string
  userId: string
  name: string
  email: string
  image: string | null
  emailVerified: boolean
}

export type OrganizationInvitation = {
  id: string
  email: string
  role: OrganizationRole | null
  status: string
  expiresAt: string
  createdAt: string
  invitedUserId: string | null
  teamId: string | null
  teamName: string | null
}

export type OrganizationTeam = {
  id: string
  name: string
  description: string | null
  leadUserId: string | null
  leadName: string | null
  memberCount: number
  createdAt: string
  updatedAt: string | null
  archivedAt: string | null
}

export type TeamMember = {
  id: string
  userId: string
  name: string
  email: string
  image: string | null
  organizationRole: OrganizationRole
  createdAt: string | null
}

export type OrganizationAuditEvent = {
  id: string
  eventType: string
  targetType: string | null
  targetId: string | null
  reason: string | null
  beforeState: unknown
  afterState: unknown
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
}

export const organizationsQueryOptions = queryOptions({
  queryKey: ['organizations'] as const,
  queryFn: async () => {
    const result = await request<{
      organizations: OrganizationSummary[]
      activeOrganizationId: string | null
    }>('/api/organizations')
    return {
      ...result,
      organizations: result.organizations ?? [],
    }
  },
  staleTime: 30_000,
})

export function organizationQueryOptions(slug: string) {
  return queryOptions({
    queryKey: ['organizations', slug] as const,
    queryFn: () =>
      request<{ organization: OrganizationMembership }>(
        `/api/organizations/${encodeURIComponent(slug)}`,
      ),
    staleTime: 30_000,
  })
}

export function organizationMembersQueryOptions(slug: string) {
  return queryOptions({
    queryKey: ['organizations', slug, 'members'] as const,
    queryFn: async () => {
      const result = await request<{
        members: OrganizationMember[]
        invitations: OrganizationInvitation[]
      }>(`/api/organizations/${encodeURIComponent(slug)}/members`)
      return {
        members: result.members ?? [],
        invitations: result.invitations ?? [],
      }
    },
  })
}

export function organizationTeamsQueryOptions(slug: string) {
  return queryOptions({
    queryKey: ['organizations', slug, 'teams'] as const,
    queryFn: async () => {
      const result = await request<{ teams: OrganizationTeam[] }>(
        `/api/organizations/${encodeURIComponent(slug)}/teams?includeArchived=true`,
      )
      return { teams: result.teams ?? [] }
    },
  })
}

export function accessibleOrganizationTeamsQueryOptions(slug: string) {
  return queryOptions({
    queryKey: ['organizations', slug, 'accessible-teams'] as const,
    queryFn: async () => {
      const result = await request<{
        teams: OrganizationTeam[]
        activeTeamId: string | null
      }>(
        `/api/organizations/${encodeURIComponent(slug)}/accessible-teams`,
      )
      return { ...result, teams: result.teams ?? [] }
    },
    enabled: Boolean(slug),
  })
}

export function teamMembersQueryOptions(slug: string, teamId: string) {
  return queryOptions({
    queryKey: ['organizations', slug, 'teams', teamId, 'members'] as const,
    queryFn: async () => {
      const result = await request<{ members: TeamMember[] }>(
        `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(teamId)}/members`,
      )
      return { members: result.members ?? [] }
    },
  })
}

export function organizationAuditQueryOptions(slug: string, page = 1) {
  return queryOptions({
    queryKey: ['organizations', slug, 'audit', page] as const,
    queryFn: async () => {
      const result = await request<{
        events: OrganizationAuditEvent[]
        pagination: { page: number; pageSize: number; total: number }
      }>(
        `/api/organizations/${encodeURIComponent(slug)}/audit-events?page=${page}`,
      )
      return { ...result, events: result.events ?? [] }
    },
  })
}

export function teamActivityQueryOptions(
  slug: string,
  teamId: string,
  page = 1,
) {
  return queryOptions({
    queryKey: ['organizations', slug, 'teams', teamId, 'activity', page] as const,
    queryFn: async () => {
      const result = await request<{
        events: OrganizationAuditEvent[]
        pagination: { page: number; pageSize: number; total: number }
      }>(
        `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(teamId)}/activity?page=${page}`,
      )
      return { ...result, events: result.events ?? [] }
    },
  })
}

export function activateOrganization(slug: string) {
  return request<{ activeOrganizationId: string }>(
    `/api/organizations/${encodeURIComponent(slug)}/activate`,
    { method: 'POST' },
  )
}

export function activateOrganizationTeam(slug: string, teamId: string) {
  return request<{ activeOrganizationId: string; activeTeamId: string }>(
    `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(teamId)}/activate`,
    { method: 'POST' },
  )
}

export function updateOrganization(
  slug: string,
  input: { name: string; slug: string; logo: string; metadata: string },
) {
  return request<{ organization: OrganizationSummary }>(
    `/api/organizations/${encodeURIComponent(slug)}`,
    { method: 'PUT', body: JSON.stringify(input) },
  )
}

export function updateOrganizationMember(
  slug: string,
  userId: string,
  role: 'admin' | 'member',
) {
  return emptyRequest(
    `/api/organizations/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
    { method: 'PUT', body: JSON.stringify({ role }) },
  )
}

export function removeOrganizationMember(slug: string, userId: string) {
  return emptyRequest(
    `/api/organizations/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  )
}

export function inviteOrganizationMember(
  slug: string,
  input: { email: string; role: 'admin' | 'member'; teamId?: string },
) {
  return request<{ invitation: OrganizationInvitation }>(
    `/api/organizations/${encodeURIComponent(slug)}/invitations`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export function cancelOrganizationInvitation(slug: string, id: string) {
  return emptyRequest(
    `/api/organizations/${encodeURIComponent(slug)}/invitations/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export function createOrganizationTeam(
  slug: string,
  input: { name: string; description: string; leadUserId: string },
) {
  return request<{ team: OrganizationTeam }>(
    `/api/organizations/${encodeURIComponent(slug)}/teams`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export function updateOrganizationTeam(
  slug: string,
  teamId: string,
  input: { name: string; description: string; leadUserId: string },
) {
  return request<{ team: OrganizationTeam }>(
    `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(teamId)}`,
    { method: 'PUT', body: JSON.stringify(input) },
  )
}

export function archiveOrganizationTeam(
  slug: string,
  teamId: string,
  archived: boolean,
) {
  return request<{ team: OrganizationTeam }>(
    `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(teamId)}/archive`,
    { method: 'POST', body: JSON.stringify({ archived }) },
  )
}

export function deleteOrganizationTeam(slug: string, teamId: string) {
  return emptyRequest(
    `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(teamId)}`,
    { method: 'DELETE' },
  )
}

export function addTeamMember(slug: string, teamId: string, userId: string) {
  return emptyRequest(
    `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(teamId)}/members`,
    { method: 'POST', body: JSON.stringify({ userId }) },
  )
}

export function removeTeamMember(slug: string, teamId: string, userId: string) {
  return emptyRequest(
    `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  )
}

export function bulkUpdateTeamMembers(
  slug: string,
  teamId: string,
  input: { action: 'add' | 'remove'; userIds: string[] },
) {
  return request<{ requestedCount: number; changedCount: number }>(
    `/api/organizations/${encodeURIComponent(slug)}/teams/${encodeURIComponent(teamId)}/members/bulk`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export function transferOrganizationOwnership(
  slug: string,
  userId: string,
  reason: string,
) {
  return emptyRequest(
    `/api/organizations/${encodeURIComponent(slug)}/transfer-ownership`,
    { method: 'POST', body: JSON.stringify({ userId, reason }) },
  )
}

export function leaveOrganization(slug: string) {
  return emptyRequest(`/api/organizations/${encodeURIComponent(slug)}/leave`, {
    method: 'POST',
  })
}

async function emptyRequest(url: string, init: RequestInit) {
  await request<unknown>(url, init, true)
}

async function request<T>(
  url: string,
  init?: RequestInit,
  empty = false,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new AuthError(
      body && typeof body.error === 'string'
        ? body.error
        : 'Something went wrong',
    )
  }
  if (empty || response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
