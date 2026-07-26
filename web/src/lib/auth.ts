import { queryOptions } from '@tanstack/react-query'

export type AuthUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  role: string
}

export type AuthSession = {
  id: string
  expiresAt: string
  createdAt: string
  updatedAt: string
  ipAddress: string | null
  userAgent: string | null
  userId: string
  impersonatedBy: string | null
  activeOrganizationId: string | null
  activeTeamId: string | null
}

export type ManagedSession = AuthSession & {
  current: boolean
}

export type SessionResponse = {
  session: AuthSession | null
  user: AuthUser | null
}

export type LoginInput = {
  email: string
  password: string
}

export type SignupInput = LoginInput & {
  name: string
}

export type UpdateProfileInput = {
  name: string
  image: string
}

export type ChangePasswordInput = {
  currentPassword: string
  newPassword: string
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export const sessionQueryOptions = queryOptions({
  queryKey: ['auth', 'session'] as const,
  queryFn: () => request<SessionResponse>('/api/auth/session'),
  staleTime: 60_000,
  retry: false,
})

export const userSessionsQueryOptions = queryOptions({
  queryKey: ['auth', 'sessions'] as const,
  queryFn: () =>
    request<{ sessions: ManagedSession[] }>('/api/auth/sessions'),
  staleTime: 30_000,
  retry: false,
})

export function login(input: LoginInput) {
  return request<SessionResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function signup(input: SignupInput) {
  return request<SessionResponse>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateProfile(input: UpdateProfileInput) {
  return request<SessionResponse>('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function changePassword(input: ChangePasswordInput) {
  return emptyRequest('/api/auth/password', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function revokeSession(sessionId: string) {
  return emptyRequest(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  })
}

export function revokeOtherSessions() {
  return emptyRequest('/api/auth/sessions', {
    method: 'DELETE',
  })
}

export async function logout() {
  return emptyRequest('/api/auth/logout', {
    method: 'POST',
  })
}

async function emptyRequest(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
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
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
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
    const message =
      body && typeof body.error === 'string'
        ? body.error
        : 'Something went wrong'
    throw new AuthError(message)
  }

  return response.json()
}
