import * as React from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { LayoutDashboardIcon, UserRoundIcon } from 'lucide-react'

import type { AuthUser } from '@/lib/auth'
import { NavUser } from '@/components/nav-user'
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
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/dashboard" />}>
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                GC
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">GC Go</span>
                <span className="truncate text-xs">Workspace</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
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
      <SidebarFooter>
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
