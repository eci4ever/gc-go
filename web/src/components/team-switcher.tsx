import { CheckIcon, ChevronsUpDownIcon, UsersIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { OrganizationTeam } from '@/lib/organizations'

export function TeamSwitcher({
  teams,
  activeTeamId,
  loading,
  switching,
  onSelect,
  onViewAll,
}: {
  teams: OrganizationTeam[]
  activeTeamId: string | null
  loading: boolean
  switching: boolean
  onSelect: (team: OrganizationTeam) => void
  onViewAll: () => void
}) {
  const activeTeam = teams.find((team) => team.id === activeTeamId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={loading || switching}
        render={
          <Button
            variant="outline"
            size="sm"
            className="min-w-36 justify-between sm:min-w-48"
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          <UsersIcon data-icon="inline-start" />
          <span className="truncate">
            {loading
              ? 'Loading teams…'
              : activeTeam?.name ?? 'Select team'}
          </span>
        </span>
        <ChevronsUpDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch team</DropdownMenuLabel>
          {teams.map((team) => (
            <DropdownMenuItem
              key={team.id}
              onClick={() => onSelect(team)}
            >
              {team.id === activeTeamId ? <CheckIcon /> : <UsersIcon />}
              <span className="min-w-0 flex-1 truncate">{team.name}</span>
              <span className="text-xs text-muted-foreground">
                {team.memberCount}
              </span>
            </DropdownMenuItem>
          ))}
          {!teams.length && (
            <DropdownMenuItem disabled>
              No teams assigned
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onViewAll}>
            View all teams
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
