import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import {
  AuthError,
  changePassword,
  disableTwoFactor,
  enableTwoFactor,
  login,
  revokeOtherSessions,
  revokeSession,
  sendEmailVerification,
  setupTwoFactor,
  verifyTwoFactorLogin,
  verifyEmail,
} from './auth'
import { server } from '@/test/server'

const user = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  emailVerified: true,
  image: null,
  role: 'user',
}

const session = {
  id: 'session-1',
  expiresAt: '2026-08-02T10:00:00Z',
  createdAt: '2026-07-26T10:00:00Z',
  updatedAt: '2026-07-26T10:00:00Z',
  ipAddress: '127.0.0.1',
  userAgent: 'Vitest',
  userId: user.id,
  impersonatedBy: null,
  activeOrganizationId: null,
  activeTeamId: null,
}

describe('auth API client', () => {
  it('returns a two-factor challenge from password login', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({
          twoFactorRequired: true,
          challengeToken: 'challenge-token',
        }),
      ),
    )

    await expect(
      login({ email: user.email, password: 'password123' }),
    ).resolves.toEqual({
      twoFactorRequired: true,
      challengeToken: 'challenge-token',
    })
  })

  it('returns the authenticated session after two-factor verification', async () => {
    server.use(
      http.post('/api/auth/2fa/verify-login', async ({ request }) => {
        await expect(request.json()).resolves.toEqual({
          challengeToken: 'challenge-token',
          code: '123456',
        })
        return HttpResponse.json({ session, user })
      }),
    )

    await expect(
      verifyTwoFactorLogin('challenge-token', '123456'),
    ).resolves.toEqual({ session, user })
  })

  it('surfaces API errors as AuthError instances', async () => {
    server.use(
      http.put('/api/auth/password', () =>
        HttpResponse.json(
          { error: 'Current password is incorrect' },
          { status: 400 },
        ),
      ),
    )

    await expect(
      changePassword({
        currentPassword: 'wrong-password',
        newPassword: 'new-password',
      }),
    ).rejects.toEqual(
      expect.objectContaining<AuthError>({
        name: 'AuthError',
        message: 'Current password is incorrect',
      }),
    )
  })

  it('calls individual and bulk session revoke endpoints', async () => {
    const requests: string[] = []
    server.use(
      http.delete('/api/auth/sessions/:id', ({ params }) => {
        requests.push(`one:${params.id}`)
        return new HttpResponse(null, { status: 204 })
      }),
      http.delete('/api/auth/sessions', () => {
        requests.push('all')
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await revokeSession('session/with space')
    await revokeOtherSessions()

    expect(requests).toEqual(['one:session/with space', 'all'])
  })

  it('supports the two-factor setup lifecycle', async () => {
    server.use(
      http.post('/api/auth/2fa/setup', () =>
        HttpResponse.json({
          secret: 'SECRET',
          uri: 'otpauth://totp/GC',
          qrCode: 'data:image/png;base64,abc',
        }),
      ),
      http.post('/api/auth/2fa/enable', () =>
        HttpResponse.json({ recoveryCodes: ['AAAA-BBBB-CCCC'] }),
      ),
      http.post(
        '/api/auth/2fa/disable',
        () => new HttpResponse(null, { status: 204 }),
      ),
    )

    await expect(setupTwoFactor('password123')).resolves.toMatchObject({
      secret: 'SECRET',
    })
    await expect(enableTwoFactor('123456')).resolves.toEqual({
      recoveryCodes: ['AAAA-BBBB-CCCC'],
    })
    await expect(
      disableTwoFactor('password123', '123456'),
    ).resolves.toBeUndefined()
  })

  it('supports sending and completing email verification', async () => {
    const requests: string[] = []
    server.use(
      http.post('/api/auth/email-verification', () => {
        requests.push('send')
        return new HttpResponse(null, { status: 204 })
      }),
      http.post(
        '/api/auth/email-verification/verify',
        async ({ request }) => {
          const body = (await request.json()) as { token: string }
          requests.push(`verify:${body.token}`)
          return new HttpResponse(null, { status: 204 })
        },
      ),
    )

    await sendEmailVerification()
    await verifyEmail('verification-token')

    expect(requests).toEqual(['send', 'verify:verification-token'])
  })
})
