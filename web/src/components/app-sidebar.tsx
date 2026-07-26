import * as React from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { LayoutDashboardIcon, UserRoundIcon } from 'lucide-react'

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

export function AppSidebar({
  user,
  onLogout,
  loggingOut,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: AuthUser
  onLogout: () => void
  loggingOut: boolean
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
