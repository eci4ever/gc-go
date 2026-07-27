import { http, HttpResponse } from 'msw'
import { cleanup, screen } from '@testing-library/react'
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

function renderSidebar() {
  server.use(
    http.get('/api/organizations', () =>
      HttpResponse.json({
        organizations: [{ id: 'org-1', name: 'Acme', slug: 'acme', role: 'member' }],
        activeOrganizationId: 'org-1',
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

describe('AppSidebar organization navigation', () => {
  beforeEach(() => {
    cleanup()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    routerMocks.navigate.mockReset()
  })

  it('keeps one stable Teams management destination', async () => {
    renderSidebar()
    expect(await screen.findByText('Teams')).toBeInTheDocument()
  })

  it('does not render individual teams in the sidebar', async () => {
    renderSidebar()
    expect(await screen.findByText('Acme')).toBeInTheDocument()
    expect(screen.queryByText('Operations')).not.toBeInTheDocument()
    expect(screen.queryByText('No teams assigned')).not.toBeInTheDocument()
  })
})
