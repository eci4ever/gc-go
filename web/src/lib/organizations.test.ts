import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  createOrganizationTeam,
  bulkUpdateTeamMembers,
  inviteOrganizationMember,
  organizationMembersQueryOptions,
  organizationTeamsQueryOptions,
  organizationsQueryOptions,
  updateOrganizationMember,
} from '@/lib/organizations'
import { server } from '@/test/server'

describe('organization workspace API client', () => {
  it('loads organizations available to the current user', async () => {
    server.use(
      http.get('/api/organizations', () =>
        HttpResponse.json({
          organizations: [{ id: 'org-1', slug: 'acme', role: 'owner' }],
          activeOrganizationId: 'org-1',
        }),
      ),
    )

    await expect(
      organizationsQueryOptions.queryFn!({} as never),
    ).resolves.toMatchObject({
      organizations: [{ slug: 'acme', role: 'owner' }],
      activeOrganizationId: 'org-1',
    })
  })

  it('normalizes empty SQL collections returned as null', async () => {
    server.use(
      http.get('/api/organizations', () =>
        HttpResponse.json({
          organizations: null,
          activeOrganizationId: null,
        }),
      ),
      http.get('/api/organizations/:slug/members', () =>
        HttpResponse.json({ members: null, invitations: null }),
      ),
      http.get('/api/organizations/:slug/teams', () =>
        HttpResponse.json({ teams: null }),
      ),
    )

    await expect(
      organizationsQueryOptions.queryFn!({} as never),
    ).resolves.toMatchObject({ organizations: [] })
    await expect(
      organizationMembersQueryOptions('acme').queryFn!({} as never),
    ).resolves.toEqual({ members: [], invitations: [] })
    await expect(
      organizationTeamsQueryOptions('acme').queryFn!({} as never),
    ).resolves.toEqual({ teams: [] })
  })

  it('sends role-scoped member and team payloads', async () => {
    const requests: unknown[] = []
    server.use(
      http.post('/api/organizations/:slug/invitations', async ({ request }) => {
        requests.push(await request.json())
        return HttpResponse.json({ invitation: { id: 'invite-1' } }, { status: 201 })
      }),
      http.put(
        '/api/organizations/:slug/members/:userId',
        async ({ request, params }) => {
          requests.push({ userId: params.userId, body: await request.json() })
          return new HttpResponse(null, { status: 204 })
        },
      ),
      http.post('/api/organizations/:slug/teams', async ({ request }) => {
        requests.push(await request.json())
        return HttpResponse.json({ team: { id: 'team-1' } }, { status: 201 })
      }),
      http.post(
        '/api/organizations/:slug/teams/:teamId/members/bulk',
        async ({ request }) => {
          requests.push(await request.json())
          return HttpResponse.json({ requestedCount: 2, changedCount: 1 })
        },
      ),
    )

    await inviteOrganizationMember('acme', {
      email: 'member@example.com',
      role: 'member',
      teamId: 'team-1',
    })
    await updateOrganizationMember('acme', 'user-2', 'admin')
    await createOrganizationTeam('acme', {
      name: 'Operations',
      description: 'Core operations',
      leadUserId: 'user-2',
    })
    await bulkUpdateTeamMembers('acme', 'team-1', {
      action: 'add',
      userIds: ['user-2', 'user-3'],
    })

    expect(requests).toEqual([
      { email: 'member@example.com', role: 'member', teamId: 'team-1' },
      { userId: 'user-2', body: { role: 'admin' } },
      {
        name: 'Operations',
        description: 'Core operations',
        leadUserId: 'user-2',
      },
      { action: 'add', userIds: ['user-2', 'user-3'] },
    ])
  })
})
