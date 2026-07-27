import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { http, HttpResponse } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthForm } from './auth-form'
import { renderWithQuery } from '@/test/render'
import { server } from '@/test/server'

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to: _to,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode
    to: string
  }) => <button {...props}>{children}</button>,
  useNavigate: () => navigateMock,
}))

const authenticatedResponse = {
  session: {
    id: 'session-1',
    expiresAt: '2026-08-02T10:00:00Z',
    createdAt: '2026-07-26T10:00:00Z',
    updatedAt: '2026-07-26T10:00:00Z',
    ipAddress: null,
    userAgent: 'Vitest',
    userId: 'user-1',
    impersonatedBy: null,
    activeOrganizationId: null,
    activeTeamId: null,
  },
  user: {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: false,
    image: null,
    role: 'user',
  },
}

describe('AuthForm', () => {
  beforeEach(() => navigateMock.mockReset())

  it('completes a password and two-factor login', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({
          twoFactorRequired: true,
          challengeToken: 'challenge-token',
        }),
      ),
      http.post('/api/auth/2fa/verify-login', () =>
        HttpResponse.json(authenticatedResponse),
      ),
    )
    const user = userEvent.setup()
    const { queryClient } = renderWithQuery(<AuthForm mode="login" />)

    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(
      await screen.findByText('Two-factor authentication'),
    ).toBeInTheDocument()

    await user.type(screen.getByLabelText('Verification code'), '123456')
    await user.click(
      screen.getByRole('button', { name: 'Verify and log in' }),
    )

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({ to: '/dashboard' }),
    )
    expect(queryClient.getQueryData(['auth', 'session'])).toEqual(
      authenticatedResponse,
    )
  })

  it('shows a server login error', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderWithQuery(<AuthForm mode="login" />)

    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(
      await screen.findByText('Invalid email or password'),
    ).toBeInTheDocument()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('renders signup-only fields and requirements', () => {
    const { container } = renderWithQuery(<AuthForm mode="signup" />)
    const signup = within(container)

    expect(
      signup.getByRole('button', { name: 'Go to home' }),
    ).toBeInTheDocument()
    expect(signup.queryByText('Back to home')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(
      screen.getByRole('checkbox', {
        name: /terms and privacy policy/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Create account' }),
    ).toBeInTheDocument()
  })
})
