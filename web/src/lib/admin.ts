import { queryOptions } from '@tanstack/react-query'

import { AuthError, type SessionResponse } from '@/lib/auth'

export type Pagination = {
  page: number
  pageSize: number
  total: number
}

export type AdminUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  role: 'user' | 'admin'
  banned: boolean
  banReason: string | null
  banExpires: string | null
  deletedAt: string | null
  createdAt: string
  activeSessions: number
  organizationCount: number
}

export type AdminUserInput = {
  name: string
  email: string
  image: string
  password?: string
  role: 'user' | 'admin'
  emailVerified: boolean
}

export type AdminOrganization = {
  id: string
  name: string
  slug: string
  logo: string | null
  metadata: string | null
  deletedAt: string | null
  createdAt: string
  ownerId: string | null
  ownerName: string | null
  ownerEmail: string | null
  memberCount: number
}

export type AdminOrganizationInput = {
  name: string
  slug: string
  logo: string
  metadata: string
  ownerId: string
}

export type OrganizationMember = {
  id: string
  role: 'owner' | 'admin' | 'member'
  createdAt: string
  userId: string
  name: string
  email: string
  image: string | null
  banned: boolean
  deletedAt: string | null
}

export type OrganizationInvitation = {
  id: string
  email: string
  role: string | null
  status: string
  expiresAt: string
  createdAt: string
  invitedUserId: string | null
}

export type AdminAuditEvent = {
  id: string
  eventType: string
  createdAt: string
  ipAddress: string | null
  userAgent: string | null
  targetType: string | null
  targetId: string | null
  reason: string | null
  beforeState: unknown
  afterState: unknown
  actorId: string
  actorName: string
  actorEmail: string
}

export type AdminDashboard = {
  totalUsers: number
  bannedUsers: number
  verifiedUsers: number
  totalOrganizations: number
  activeSessions: number
  pendingInvitations: number
  userGrowth: { date: string; users: number }[]
}

export const adminUsersKey = ['admin', 'users'] as const
export const adminOrganizationsKey = ['admin', 'organizations'] as const

export function adminUsersQueryOptions(params: {
  page?: number
  pageSize?: number
  search?: string
  role?: string
  status?: string
  includeDeleted?: boolean
} = {}) {
  return queryOptions({
    queryKey: [...adminUsersKey, params] as const,
    queryFn: () =>
      adminRequest<{ users: AdminUser[]; pagination: Pagination }>(
        `/api/admin/users?${queryString(params)}`,
      ),
    staleTime: 30_000,
    retry: false,
  })
}

export function adminOrganizationsQueryOptions(params: {
  page?: number
  pageSize?: number
  search?: string
  includeDeleted?: boolean
} = {}) {
  return queryOptions({
    queryKey: [...adminOrganizationsKey, params] as const,
    queryFn: () =>
      adminRequest<{
        organizations: AdminOrganization[]
        pagination: Pagination
      }>(`/api/admin/organizations?${queryString(params)}`),
    staleTime: 30_000,
    retry: false,
  })
}

export function adminOrganizationMembersQueryOptions(organizationId: string) {
  return queryOptions({
    queryKey: ['admin', 'organizations', organizationId, 'members'] as const,
    queryFn: () =>
      adminRequest<{
        members: OrganizationMember[]
        invitations: OrganizationInvitation[]
      }>(
        `/api/admin/organizations/${encodeURIComponent(organizationId)}/members`,
      ),
    enabled: Boolean(organizationId),
    staleTime: 15_000,
    retry: false,
  })
}

export function adminAuditQueryOptions(params: {
  page?: number
  pageSize?: number
  search?: string
} = {}) {
  return queryOptions({
    queryKey: ['admin', 'audit-events', params] as const,
    queryFn: () =>
      adminRequest<{ events: AdminAuditEvent[]; pagination: Pagination }>(
        `/api/admin/audit-events?${queryString(params)}`,
      ),
    staleTime: 15_000,
    retry: false,
  })
}

export const adminDashboardQueryOptions = queryOptions({
  queryKey: ['admin', 'dashboard'] as const,
  queryFn: () => adminRequest<AdminDashboard>('/api/admin/dashboard'),
  staleTime: 30_000,
  retry: false,
})

export function createAdminUser(input: AdminUserInput) {
  return adminRequest('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateAdminUser(userId: string, input: AdminUserInput) {
  return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function deleteAdminUser(userId: string) {
  return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}

export function restoreAdminUser(userId: string) {
  return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/restore`, {
    method: 'POST',
  })
}

export function bulkAdminUsers(input: {
  action: string
  userIds: string[]
  reason?: string
  organizationId?: string
}) {
  return adminRequest<{ updated: number }>('/api/admin/users/bulk', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function setAdminUserBan(
  userId: string,
  input: { banned: boolean; reason: string; expiresAt: string },
) {
  return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/ban`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function impersonateAdminUser(
  userId: string,
  input: { reason: string; durationMinutes: number },
) {
  return adminRequest<SessionResponse>(
    `/api/admin/users/${encodeURIComponent(userId)}/impersonate`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export function stopImpersonation() {
  return adminRequest<SessionResponse>('/api/auth/impersonation/stop', {
    method: 'POST',
  })
}

export function createAdminOrganization(input: AdminOrganizationInput) {
  return adminRequest('/api/admin/organizations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateAdminOrganization(
  organizationId: string,
  input: AdminOrganizationInput,
) {
  return adminRequest(
    `/api/admin/organizations/${encodeURIComponent(organizationId)}`,
    { method: 'PUT', body: JSON.stringify(input) },
  )
}

export function deleteAdminOrganization(organizationId: string) {
  return adminRequest(
    `/api/admin/organizations/${encodeURIComponent(organizationId)}`,
    { method: 'DELETE' },
  )
}

export function restoreAdminOrganization(organizationId: string) {
  return adminRequest(
    `/api/admin/organizations/${encodeURIComponent(organizationId)}/restore`,
    { method: 'POST' },
  )
}

export function addOrganizationMember(
  organizationId: string,
  input: { userId: string; role: 'admin' | 'member' },
) {
  return adminRequest(
    `/api/admin/organizations/${encodeURIComponent(organizationId)}/members`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export function updateOrganizationMember(
  organizationId: string,
  userId: string,
  role: 'admin' | 'member',
) {
  return adminRequest(
    `/api/admin/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
    { method: 'PUT', body: JSON.stringify({ role }) },
  )
}

export function removeOrganizationMember(
  organizationId: string,
  userId: string,
) {
  return adminRequest(
    `/api/admin/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  )
}

export function inviteOrganizationMember(
  organizationId: string,
  input: { email: string; role: 'admin' | 'member' },
) {
  return adminRequest(
    `/api/admin/organizations/${encodeURIComponent(organizationId)}/invitations`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export function cancelOrganizationInvitation(
  organizationId: string,
  invitationId: string,
) {
  return adminRequest(
    `/api/admin/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}`,
    { method: 'DELETE' },
  )
}

export function acceptOrganizationInvitation(token: string) {
  return adminRequest<{ organizationId: string; organizationName: string }>(
    '/api/auth/invitations/accept',
    { method: 'POST', body: JSON.stringify({ token }) },
  )
}

function queryString(params: Record<string, unknown>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '' && value !== false) {
      query.set(key, String(value))
    }
  }
  return query
}

async function adminRequest<T = void>(
  url: string,
  init?: RequestInit,
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
  if (response.status === 204) return undefined as T
  return response.json()
}
