import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithQuery } from '@/test/render'
import { TeamSwitcher } from './team-switcher'

const teams = [
  {
    id: 'team-1',
    name: 'Operations',
    description: null,
    leadUserId: null,
    leadName: null,
    memberCount: 8,
    createdAt: '2026-07-27T00:00:00Z',
    updatedAt: null,
    archivedAt: null,
  },
  {
    id: 'team-2',
    name: 'Support',
    description: null,
    leadUserId: null,
    leadName: null,
    memberCount: 4,
    createdAt: '2026-07-27T00:00:00Z',
    updatedAt: null,
    archivedAt: null,
  },
]

describe('TeamSwitcher', () => {
  it('shows the active team and selects another team', async () => {
    const onSelect = vi.fn()
    const browser = userEvent.setup()
    renderWithQuery(
      <TeamSwitcher
        teams={teams}
        activeTeamId="team-1"
        loading={false}
        switching={false}
        onSelect={onSelect}
        onViewAll={() => undefined}
      />,
    )

    await browser.click(screen.getByRole('button', { name: /operations/i }))
    await browser.click(await screen.findByText('Support'))

    expect(onSelect).toHaveBeenCalledWith(teams[1])
  })

  it('offers the teams index when no teams are assigned', async () => {
    const onViewAll = vi.fn()
    const browser = userEvent.setup()
    renderWithQuery(
      <TeamSwitcher
        teams={[]}
        activeTeamId={null}
        loading={false}
        switching={false}
        onSelect={() => undefined}
        onViewAll={onViewAll}
      />,
    )

    await browser.click(screen.getByRole('button', { name: /select team/i }))
    expect(await screen.findByText('No teams assigned')).toBeInTheDocument()
    await browser.click(screen.getByText('View all teams'))

    expect(onViewAll).toHaveBeenCalledOnce()
  })
})
