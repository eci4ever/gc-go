import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import {
  adminOrganizationsQueryOptions,
  adminUsersQueryOptions,
  createAdminOrganization,
  impersonateAdminUser,
  setAdminUserBan,
} from '@/lib/admin'
import { server } from '@/test/server'

describe('platform admin API client', () => {
  it('loads users and organizations', async () => {
    server.use(
      http.get('/api/admin/users', () =>
        HttpResponse.json({ users: [{ id: 'user-1' }] }),
      ),
      http.get('/api/admin/organizations', () =>
        HttpResponse.json({ organizations: [{ id: 'org-1' }] }),
      ),
    )

    await expect(adminUsersQueryOptions().queryFn!({} as never)).resolves.toEqual({
      users: [{ id: 'user-1' }],
    })
    await expect(
      adminOrganizationsQueryOptions().queryFn!({} as never),
    ).resolves.toEqual({
      organizations: [{ id: 'org-1' }],
    })
  })

  it('sends organization and ban management payloads', async () => {
    const requests: unknown[] = []
    server.use(
      http.post('/api/admin/organizations', async ({ request }) => {
        requests.push(await request.json())
        return HttpResponse.json({ organization: { id: 'org-1' } }, { status: 201 })
      }),
      http.post('/api/admin/users/:id/ban', async ({ request, params }) => {
        requests.push({ id: params.id, body: await request.json() })
        return HttpResponse.json({ user: { id: params.id } })
      }),
    )

    await createAdminOrganization({
      name: 'Acme',
      slug: 'acme',
      logo: '',
      metadata: '{"plan":"pro"}',
      ownerId: 'user-1',
    })
    await setAdminUserBan('user-2', {
      banned: true,
      reason: 'Abuse',
      expiresAt: '',
    })

    expect(requests).toEqual([
      {
        name: 'Acme',
        slug: 'acme',
        logo: '',
        metadata: '{"plan":"pro"}',
        ownerId: 'user-1',
      },
      {
        id: 'user-2',
        body: { banned: true, reason: 'Abuse', expiresAt: '' },
      },
    ])
  })

  it('returns the impersonated session', async () => {
    server.use(
      http.post('/api/admin/users/:id/impersonate', ({ params }) =>
        HttpResponse.json({
          session: {
            id: 'session-2',
            userId: params.id,
            impersonatedBy: 'admin-1',
          },
          user: { id: params.id, role: 'user' },
        }),
      ),
    )

    await expect(
      impersonateAdminUser('user-2', {
        reason: 'Support',
        durationMinutes: 30,
      }),
    ).resolves.toMatchObject({
      session: { impersonatedBy: 'admin-1' },
      user: { id: 'user-2' },
    })
  })
})
