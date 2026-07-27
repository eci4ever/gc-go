import { http, HttpResponse } from 'msw'
import { cleanup, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithQuery } from '@/test/render'
import { server } from '@/test/server'
import { SidebarProvider } from '@/components/ui/sidebar'

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useRouterState: () => '/organizations/acme',
    Link: ({ children, to, ...props }: React.ComponentProps<'a'> & { to: string }) => (
      <a href={to} {...props}>{children}</a>
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
  })

  it('handles a user with zero accessible teams', async () => {
    renderSidebar([])
    expect(await screen.findByText('No teams assigned')).toBeInTheDocument()
  })

  it('renders one accessible active team', async () => {
    renderSidebar([{ id: 'team-1', name: 'Operations' }], 'team-1')
    expect(await screen.findByText('Operations')).toBeInTheDocument()
  })

  it('renders multiple accessible teams without archived or stale entries', async () => {
    renderSidebar([
      { id: 'team-1', name: 'Operations' },
      { id: 'team-2', name: 'Support' },
    ], 'missing-team')
    expect(await screen.findByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('Support')).toBeInTheDocument()
  })
})
