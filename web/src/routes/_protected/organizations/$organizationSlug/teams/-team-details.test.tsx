import { http, HttpResponse, delay } from 'msw'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithQuery } from '@/test/render'
import { server } from '@/test/server'

const mocks = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'admin' | 'member',
  archived: false,
  navigate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    getRouteApi: () => ({
      useRouteContext: () => ({
        organization: { id: 'org-1', slug: 'acme', role: mocks.role },
      }),
      useParams: () => ({ organizationSlug: 'acme', teamId: 'team-1' }),
    }),
    useNavigate: () => mocks.navigate,
  }
})

vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error },
}))

import { TeamDetails } from './-team-details'

const assigned = {
  id: 'team-member-1',
  userId: 'user-1',
  name: 'Assigned User',
  email: 'assigned@example.com',
  image: null,
  organizationRole: 'member',
  createdAt: '2026-07-27T00:00:00Z',
}
const available = {
  id: 'member-2',
  userId: 'user-2',
  name: 'Available User',
  email: 'available@example.com',
  image: null,
  role: 'admin',
  emailVerified: true,
  createdAt: '2026-07-27T00:00:00Z',
}

function handlers(
  bulk: Parameters<typeof http.post>[1] = async ({ request }) =>
    HttpResponse.json({
      requestedCount: ((await request.json()) as { userIds: string[] }).userIds.length,
      changedCount: 1,
    }),
) {
  server.use(
    http.get('/api/organizations/:slug/teams', () =>
      HttpResponse.json({
        teams: [{
          id: 'team-1',
          name: 'Operations',
          description: 'Core team',
          leadUserId: 'user-1',
          leadName: 'Assigned User',
          memberCount: 1,
          createdAt: '2026-07-27T00:00:00Z',
          updatedAt: null,
          archivedAt: mocks.archived ? '2026-07-27T01:00:00Z' : null,
        }],
      }),
    ),
    http.get('/api/organizations/:slug/members', () =>
      HttpResponse.json({ members: [
        { ...assigned, role: 'member', emailVerified: true },
        available,
      ], invitations: [] }),
    ),
    http.get('/api/organizations/:slug/teams/:teamId/members', () =>
      HttpResponse.json({ members: [assigned] }),
    ),
    http.post('/api/organizations/:slug/teams/:teamId/members/bulk', bulk),
  )
}

describe('TeamDetails member management', () => {
  beforeEach(() => {
    cleanup()
    mocks.role = 'owner'
    mocks.archived = false
    mocks.navigate.mockReset()
    mocks.success.mockReset()
    mocks.error.mockReset()
  })

  it('renders organization members in read-only mode for member role', async () => {
    mocks.role = 'member'
    handlers()
    renderWithQuery(<TeamDetails />)

    expect(await screen.findByText('Assigned User')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Add organization members')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove selected/i })).not.toBeInTheDocument()
  })

  it.each(['owner', 'admin'] as const)(
    '%s selects assigned and available members and submits bulk payloads',
    async (role) => {
      mocks.role = role
      const payloads: unknown[] = []
      handlers(async ({ request }) => {
        payloads.push(await request.json())
        return HttpResponse.json({ requestedCount: 1, changedCount: 1 })
      })
      const user = userEvent.setup()
      renderWithQuery(<TeamDetails />)

      await user.click(await screen.findByRole('checkbox', { name: 'Select Assigned User' }))
      await user.click(screen.getByRole('button', { name: 'Remove selected (1)' }))
      await waitFor(() => expect(payloads).toContainEqual({ action: 'remove', userIds: ['user-1'] }))

      await user.click(screen.getByRole('checkbox', { name: 'Select Available User' }))
      await user.click(screen.getByRole('button', { name: 'Add selected (1)' }))
      await waitFor(() => expect(payloads).toContainEqual({ action: 'add', userIds: ['user-2'] }))
      expect(mocks.success).toHaveBeenCalledTimes(2)
    },
  )

  it('disables team editing and member controls for archived teams', async () => {
    mocks.archived = true
    handlers()
    renderWithQuery(<TeamDetails />)

    expect(await screen.findByDisplayValue('Operations')).toBeDisabled()
    expect(screen.getByDisplayValue('Core team')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save team' })).toBeDisabled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByText('Add organization members')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /restore/i })).toBeEnabled()
  })

  it('disables the bulk action while its mutation is pending and toasts success', async () => {
    handlers(async () => {
      await delay(100)
      return HttpResponse.json({ requestedCount: 1, changedCount: 1 })
    })
    const user = userEvent.setup()
    renderWithQuery(<TeamDetails />)

    await user.click(await screen.findByRole('checkbox', { name: 'Select Available User' }))
    const action = screen.getByRole('button', { name: 'Add selected (1)' })
    await user.click(action)
    expect(action).toBeDisabled()
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('1 member added'))
  })

  it('shows an error toast when a bulk mutation fails', async () => {
    handlers(() => HttpResponse.json({ error: 'Unable to update team members' }, { status: 500 }))
    const user = userEvent.setup()
    renderWithQuery(<TeamDetails />)

    await user.click(await screen.findByRole('checkbox', { name: 'Select Assigned User' }))
    await user.click(screen.getByRole('button', { name: 'Remove selected (1)' }))
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith('Unable to update team members'),
    )
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('sends a team-targeted invitation payload', async () => {
    handlers()
    let payload: unknown
    server.use(
      http.post('/api/organizations/:slug/invitations', async ({ request }) => {
        payload = await request.json()
        return HttpResponse.json({ invitation: { id: 'invite-1' } }, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderWithQuery(<TeamDetails />)

    await user.click(await screen.findByRole('button', { name: /invite to team/i }))
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))

    await waitFor(() => expect(payload).toEqual({
      email: 'new@example.com',
      role: 'member',
      teamId: 'team-1',
    }))
    expect(mocks.success).toHaveBeenCalledWith('Team invitation sent')
  })

  it('shows pending team invitations and cancels them', async () => {
    handlers()
    let cancelled = ''
    server.use(
      http.get('/api/organizations/:slug/members', () =>
        HttpResponse.json({
          members: [{ ...assigned, role: 'member', emailVerified: true }, available],
          invitations: [{
            id: 'invite-1',
            email: 'pending@example.com',
            role: 'member',
            status: 'pending',
            expiresAt: '2026-08-03T00:00:00Z',
            createdAt: '2026-07-27T00:00:00Z',
            invitedUserId: null,
            teamId: 'team-1',
            teamName: 'Operations',
          }],
        }),
      ),
      http.delete('/api/organizations/:slug/invitations/:invitationId', ({ params }) => {
        cancelled = String(params.invitationId)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = userEvent.setup()
    renderWithQuery(<TeamDetails />)

    expect(await screen.findByText('pending@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(cancelled).toBe('invite-1'))
    expect(mocks.success).toHaveBeenCalledWith('Invitation cancelled')
  })

  it('hides invitation controls from read-only members', async () => {
    mocks.role = 'member'
    handlers()
    renderWithQuery(<TeamDetails />)

    await screen.findByText('Assigned User')
    expect(screen.queryByRole('button', { name: /invite to team/i })).not.toBeInTheDocument()
  })

  it('toasts invitation errors', async () => {
    handlers()
    server.use(
      http.post('/api/organizations/:slug/invitations', () =>
        HttpResponse.json({ error: 'A pending invitation already exists' }, { status: 409 }),
      ),
    )
    const user = userEvent.setup()
    renderWithQuery(<TeamDetails />)

    await user.click(await screen.findByRole('button', { name: /invite to team/i }))
    await user.type(screen.getByLabelText('Email'), 'duplicate@example.com')
    await user.click(screen.getByRole('button', { name: 'Send invitation' }))
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith('A pending invitation already exists'),
    )
  })
})
