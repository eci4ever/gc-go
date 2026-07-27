import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ChevronsUpDownIcon,
  Building2Icon,
  FileClockIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  ShieldCheckIcon,
  KeyRoundIcon,
  UserRoundIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";

import type { AuthUser } from "@/lib/auth";
import { NavUser } from "@/components/nav-user";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  activateOrganization,
  organizationsQueryOptions,
} from "@/lib/organizations";
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
} from "@/components/ui/sidebar";

const navigation = [
  {
    title: "Dashboard",
    to: "/dashboard" as const,
    icon: LayoutDashboardIcon,
  },
  {
    title: "Account",
    to: "/account" as const,
    icon: UserRoundIcon,
  },
];

const adminNavigation = [
  {
    title: "Overview",
    to: "/admin" as const,
    icon: GaugeIcon,
  },
  {
    title: "Users",
    to: "/admin/users" as const,
    icon: UsersIcon,
  },
  {
    title: "Organizations",
    to: "/admin/organizations" as const,
    icon: Building2Icon,
  },
  {
    title: "Audit Log",
    to: "/admin/audit" as const,
    icon: FileClockIcon,
  },
];

export function AppSidebar({
  user,
  onLogout,
  loggingOut,
  platformAdmin,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: AuthUser;
  onLogout: () => void;
  loggingOut: boolean;
  platformAdmin: boolean;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const queryClient = useQueryClient();
  const organizations = useQuery(organizationsQueryOptions);
  const active =
    organizations.data?.organizations.find((item) =>
      pathname.startsWith(`/organizations/${item.slug}`),
    ) ??
    organizations.data?.organizations.find(
      (item) => item.id === organizations.data?.activeOrganizationId,
    ) ??
    organizations.data?.organizations[0];
  const activate = useMutation({
    mutationFn: activateOrganization,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["organizations"] }),
    onError: (error) => toast.error(error.message),
  });
  const organizationNavigation = active
    ? [
        { title: "Overview", suffix: "", icon: GaugeIcon },
        { title: "Members", suffix: "/members", icon: UsersIcon },
        { title: "Teams", suffix: "/teams", icon: Building2Icon },
        ...(active.role === "owner"
          ? [
              { title: "Audit Log", suffix: "/audit", icon: FileClockIcon },
              { title: "Roles", suffix: "/roles", icon: KeyRoundIcon },
              { title: "Settings", suffix: "/settings", icon: ShieldCheckIcon },
            ]
          : []),
      ]
    : [];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="group-data-[collapsible=icon]:px-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton size="lg" tooltip="Switch organization" />
                }
              >
                <Avatar>
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {active ? active.name.slice(0, 2).toUpperCase() : "GC"}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {active?.name ?? "GC Go"}
                  </span>
                  <span className="truncate text-xs capitalize">
                    {active?.role ?? "Personal workspace"}
                  </span>
                </div>
                <ChevronsUpDownIcon className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64" align="start" side="right">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Organizations</DropdownMenuLabel>
                  {organizations.data?.organizations.map((organization) => (
                    <DropdownMenuItem
                      key={organization.id}
                      render={
                        <Link
                          to="/organizations/$organizationSlug"
                          params={{ organizationSlug: organization.slug }}
                          onClick={() => activate.mutate(organization.slug)}
                        />
                      }
                    >
                      <Building2Icon />
                      <span className="min-w-0 flex-1 truncate">
                        {organization.name}
                      </span>
                      <span className="text-xs capitalize text-muted-foreground">
                        {organization.role}
                      </span>
                    </DropdownMenuItem>
                  ))}
                  {!organizations.data?.organizations.length && (
                    <DropdownMenuItem disabled>
                      No organizations
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link to="/dashboard" />}>
                  Personal dashboard
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        {active && (
          <SidebarGroup className="group-data-[collapsible=icon]:px-3">
            <SidebarGroupLabel>Organization</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {organizationNavigation.map((item) => {
                  const to = `/organizations/${active.slug}${item.suffix}`;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        isActive={pathname === to}
                        tooltip={item.title}
                        render={<Link to={to} />}
                      >
                        <item.icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
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
        <NavUser user={user} onLogout={onLogout} loggingOut={loggingOut} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
