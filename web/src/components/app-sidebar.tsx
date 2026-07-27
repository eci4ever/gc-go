import * as React from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Building2Icon,
  FileClockIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  UserRoundIcon,
  UsersIcon,
} from 'lucide-react'

import type { AuthUser } from '@/lib/auth'
import { NavUser } from '@/components/nav-user'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

const navigation = [
  {
    title: 'Dashboard',
    to: '/dashboard' as const,
    icon: LayoutDashboardIcon,
  },
  {
    title: 'Account',
    to: '/account' as const,
    icon: UserRoundIcon,
  },
]

const adminNavigation = [
  {
    title: 'Overview',
    to: '/admin' as const,
    icon: GaugeIcon,
  },
  {
    title: 'Users',
    to: '/admin/users' as const,
    icon: UsersIcon,
  },
  {
    title: 'Organizations',
    to: '/admin/organizations' as const,
    icon: Building2Icon,
  },
  {
    title: 'Audit Log',
    to: '/admin/audit' as const,
    icon: FileClockIcon,
  },
]

export function AppSidebar({
  user,
  onLogout,
  loggingOut,
  platformAdmin,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: AuthUser
  onLogout: () => void
  loggingOut: boolean
  platformAdmin: boolean
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="group-data-[collapsible=icon]:px-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/dashboard" />}>
              <Avatar>
                <AvatarFallback className="bg-primary text-primary-foreground">
                  GC
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">GC Go</span>
                <span className="truncate text-xs">Workspace</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="group-data-[collapsible=icon]:px-3">
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    isActive={pathname === item.to}
                    tooltip={item.title}
                    render={<Link to={item.to} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {platformAdmin ? (
          <SidebarGroup className="group-data-[collapsible=icon]:px-3">
            <SidebarGroupLabel>Platform Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminNavigation.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={pathname === item.to}
                      tooltip={item.title}
                      render={<Link to={item.to} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter className="group-data-[collapsible=icon]:px-3">
        <NavUser
          user={user}
          onLogout={onLogout}
          loggingOut={loggingOut}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
