import { queryOptions } from '@tanstack/react-query'

import {
  AuthError,
  type SessionResponse,
} from '@/lib/auth'

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

export const adminUsersQueryOptions = queryOptions({
  queryKey: ['admin', 'users'] as const,
  queryFn: () => adminRequest<{ users: AdminUser[] }>('/api/admin/users'),
  staleTime: 30_000,
  retry: false,
})

export const adminOrganizationsQueryOptions = queryOptions({
  queryKey: ['admin', 'organizations'] as const,
  queryFn: () =>
    adminRequest<{ organizations: AdminOrganization[] }>(
      '/api/admin/organizations',
    ),
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

export function setAdminUserBan(
  userId: string,
  input: { banned: boolean; reason: string; expiresAt: string },
) {
  return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/ban`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function impersonateAdminUser(userId: string) {
  return adminRequest<SessionResponse>(
    `/api/admin/users/${encodeURIComponent(userId)}/impersonate`,
    { method: 'POST' },
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
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  )
}

export function deleteAdminOrganization(organizationId: string) {
  return adminRequest(
    `/api/admin/organizations/${encodeURIComponent(organizationId)}`,
    { method: 'DELETE' },
  )
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
