import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Building2Icon,
  FileClockIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserRoundIcon,
  UsersIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import type { OrganizationSummary } from '@/lib/organizations'

export function AppCommandMenu({
  organizations,
  platformAdmin,
}: {
  organizations: OrganizationSummary[]
  platformAdmin: boolean
}) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function run(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="hidden min-w-40 justify-between lg:flex"
        onClick={() => setOpen(true)}
      >
        <span className="flex items-center gap-2 text-muted-foreground">
          <SearchIcon data-icon="inline-start" />
          Search
        </span>
        <span className="text-[10px] text-muted-foreground">⌘ K</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open command menu"
        onClick={() => setOpen(true)}
      >
        <SearchIcon aria-hidden="true" />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command>
          <CommandInput placeholder="Search pages and organizations…" />
          <CommandList>
            <CommandEmpty>No matching page found.</CommandEmpty>
            <CommandGroup heading="Personal">
              <CommandItem
                onSelect={() => run(() => void navigate({ to: '/dashboard' }))}
              >
                <LayoutDashboardIcon />
                Dashboard
                <CommandShortcut>Home</CommandShortcut>
              </CommandItem>
              <CommandItem
                onSelect={() => run(() => void navigate({ to: '/account' }))}
              >
                <UserRoundIcon />
                Account
              </CommandItem>
            </CommandGroup>
            {organizations.length ? (
              <>
                <CommandSeparator />
                {organizations.map((organization) => (
                  <CommandGroup
                    key={organization.id}
                    heading={organization.name}
                  >
                    <CommandItem
                      onSelect={() =>
                        run(() =>
                          void navigate({
                            to: '/organizations/$organizationSlug',
                            params: { organizationSlug: organization.slug },
                          }),
                        )
                      }
                    >
                      <Building2Icon />
                      Overview
                    </CommandItem>
                    <CommandItem
                      onSelect={() =>
                        run(() =>
                          void navigate({
                            to: '/organizations/$organizationSlug/members',
                            params: { organizationSlug: organization.slug },
                          }),
                        )
                      }
                    >
                      <UsersIcon />
                      Members
                    </CommandItem>
                    <CommandItem
                      onSelect={() =>
                        run(() =>
                          void navigate({
                            to: '/organizations/$organizationSlug/teams',
                            params: { organizationSlug: organization.slug },
                          }),
                        )
                      }
                    >
                      <ShieldCheckIcon />
                      Teams
                    </CommandItem>
                    {organization.role === 'owner' ? (
                      <>
                        <CommandItem
                          onSelect={() =>
                            run(() =>
                              void navigate({
                                to: '/organizations/$organizationSlug/roles',
                                params: {
                                  organizationSlug: organization.slug,
                                },
                              }),
                            )
                          }
                        >
                          <KeyRoundIcon />
                          Roles & permissions
                        </CommandItem>
                        <CommandItem
                          onSelect={() =>
                            run(() =>
                              void navigate({
                                to: '/organizations/$organizationSlug/settings',
                                params: {
                                  organizationSlug: organization.slug,
                                },
                              }),
                            )
                          }
                        >
                          <SettingsIcon />
                          Settings
                        </CommandItem>
                      </>
                    ) : null}
                  </CommandGroup>
                ))}
              </>
            ) : null}
            {platformAdmin ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Platform administration">
                  <CommandItem
                    onSelect={() =>
                      run(() => void navigate({ to: '/admin/users' }))
                    }
                  >
                    <UsersIcon />
                    Manage users
                  </CommandItem>
                  <CommandItem
                    onSelect={() =>
                      run(() => void navigate({ to: '/admin/organizations' }))
                    }
                  >
                    <Building2Icon />
                    Manage organizations
                  </CommandItem>
                  <CommandItem
                    onSelect={() =>
                      run(() => void navigate({ to: '/admin/audit' }))
                    }
                  >
                    <FileClockIcon />
                    Audit log
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
