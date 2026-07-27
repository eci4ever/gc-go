import { http, HttpResponse } from 'msw'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithQuery } from '@/test/render'
import { server } from '@/test/server'
import { SidebarProvider } from '@/components/ui/sidebar'

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useRouterState: () => '/organizations/acme',
    Link: ({ children, to, onClick, ...props }: React.ComponentProps<'a'> & { to: string }) => (
      <a
        href={to}
        {...props}
        onClick={(event) => {
          event.preventDefault()
          onClick?.(event)
          routerMocks.navigate(to)
        }}
      >
        {children}
      </a>
    ),
  }
})

import { AppSidebar } from './app-sidebar'

const user = {
  id: 'user-1',
  name: 'Alex User',
  email: 'alex@example.com',
  emailVerified: true,
  image: null,
  role: 'user',
}

function renderSidebar(teams: Array<{ id: string; name: string }>, activeTeamId: string | null = null) {
  server.use(
    http.get('/api/organizations', () =>
      HttpResponse.json({
        organizations: [{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'member' }],
        activeOrganizationId: 'org-1',
      }),
    ),
    http.get('/api/organizations/:slug/accessible-teams', () =>
      HttpResponse.json({
        teams: teams.map((team) => ({
          ...team,
          description: null,
          leadUserId: null,
          leadName: null,
          memberCount: 1,
          createdAt: '2026-07-27T00:00:00Z',
          updatedAt: null,
          archivedAt: null,
        })),
        activeTeamId,
      }),
    ),
  )
  return renderWithQuery(
    <SidebarProvider>
      <AppSidebar
        user={user}
        onLogout={() => undefined}
        loggingOut={false}
        platformAdmin={false}
      />
    </SidebarProvider>,
  )
}

describe('AppSidebar team context', () => {
  beforeEach(() => {
    cleanup()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    routerMocks.navigate.mockReset()
  })

  it('handles a user with zero accessible teams', async () => {
    renderSidebar([])
    expect(await screen.findByText('No teams assigned')).toBeInTheDocument()
  })

  it('renders one accessible active team', async () => {
    renderSidebar([{ id: 'team-1', name: 'Operations' }], 'team-1')
    const team = await screen.findByText('Operations')
    expect(team.closest('[data-active]')).not.toBeNull()
  })

  it('renders multiple accessible teams without archived or stale entries', async () => {
    renderSidebar([
      { id: 'team-1', name: 'Operations' },
      { id: 'team-2', name: 'Support' },
    ], 'missing-team')
    expect(await screen.findByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(screen.getByText('Operations').closest('[data-active]')).toBeNull()
    expect(screen.getByText('Support').closest('[data-active]')).toBeNull()
  })

  it('activates a selected team, navigates, and refreshes team context', async () => {
    let activation = ''
    let accessibleRequests = 0
    server.use(
      http.get('/api/organizations', () =>
        HttpResponse.json({
          organizations: [{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'member' }],
          activeOrganizationId: 'org-1',
        }),
      ),
      http.get('/api/organizations/:slug/accessible-teams', () => {
        accessibleRequests += 1
        return HttpResponse.json({
          teams: [{
            id: 'team-1',
            name: 'Operations',
            description: null,
            leadUserId: null,
            leadName: null,
            memberCount: 1,
            createdAt: '2026-07-27T00:00:00Z',
            updatedAt: null,
            archivedAt: null,
          }],
          activeTeamId: accessibleRequests > 1 ? 'team-1' : null,
        })
      }),
      http.post('/api/organizations/:slug/teams/:teamId/activate', ({ params }) => {
        activation = String(params.teamId)
        return HttpResponse.json({
          activeOrganizationId: 'org-1',
          activeTeamId: params.teamId,
        })
      }),
    )
    renderWithQuery(
      <SidebarProvider>
        <AppSidebar
          user={user}
          onLogout={() => undefined}
          loggingOut={false}
          platformAdmin={false}
        />
      </SidebarProvider>,
    )
    const browser = userEvent.setup()
    await browser.click(await screen.findByText('Operations'))

    await waitFor(() => expect(activation).toBe('team-1'))
    expect(routerMocks.navigate).toHaveBeenCalledWith(
      '/organizations/acme/teams/team-1',
    )
    await waitFor(() => expect(accessibleRequests).toBeGreaterThan(1))
    expect(screen.getByText('Operations').closest('[data-active]')).not.toBeNull()
  })
})
