import { queryOptions } from '@tanstack/react-query'

export type AuthUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  role: string
}

export type SessionResponse = {
  user: AuthUser | null
}

export type LoginInput = {
  email: string
  password: string
}

export type SignupInput = LoginInput & {
  name: string
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

export async function logout() {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw new AuthError('Unable to log out')
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
