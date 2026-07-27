import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { PlusIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type {
  OrganizationCustomRole,
  OrganizationPermission,
  TeamRole,
} from "@/lib/organizations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createOrganizationRole,
  createTeamRole,
  deleteOrganizationRole,
  deleteTeamRole,
  organizationRolesQueryOptions,
  teamRolesQueryOptions,
  updateOrganizationRole,
  updateTeamRole,
} from "@/lib/organizations";

export const Route = createFileRoute(
  "/_protected/organizations/$organizationSlug/roles",
)({
  beforeLoad: ({ context }) => {
    if (context.organization.role !== "owner") {
      throw redirect({
        to: "/organizations/$organizationSlug",
        params: { organizationSlug: context.organization.slug },
      });
    }
  },
  component: OrganizationRoles,
});

function OrganizationRoles() {
  const { organizationSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const query = useQuery(organizationRolesQueryOptions(organizationSlug));
  const teamRoles = useQuery(teamRolesQueryOptions(organizationSlug));
  const [editing, setEditing] = useState<OrganizationCustomRole | "new" | null>(
    null,
  );
  const [editingTeamRole, setEditingTeamRole] = useState<
    TeamRole | "new" | null
  >(null);
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["organizations", organizationSlug],
    });
  const remove = useMutation({
    mutationFn: (roleId: string) =>
      deleteOrganizationRole(organizationSlug, roleId),
    onSuccess: async () => {
      toast.success("Custom role deleted");
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({
          queryKey: ["organizations", organizationSlug, "members"],
        }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });
  const removeTeamRole = useMutation({
    mutationFn: (roleId: string) => deleteTeamRole(organizationSlug, roleId),
    onSuccess: async () => {
      toast.success("Team role deleted");
      await queryClient.invalidateQueries({
        queryKey: ["organizations", organizationSlug, "team-roles"],
      });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-wide uppercase">
            Roles & permissions
          </h1>
          <p className="text-sm text-muted-foreground">
            Combine platform-defined permissions into roles for your members.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <PlusIcon />
          Create role
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Standard roles</CardTitle>
          <CardDescription>
            Owner, admin, and member permissions are managed by the platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {[
            [
              "Owner",
              "Full organization control, including custom roles and ownership.",
            ],
            [
              "Admin",
              "Manage members and teams without access to ownership or role design.",
            ],
            ["Member", "View organization members and assigned teams."],
          ].map(([name, description]) => (
            <div key={name} className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheckIcon className="size-4 text-primary" />
                <p className="font-medium">{name}</p>
                <Badge variant="outline">System</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {query.data?.roles.map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{role.name}</CardTitle>
                  <CardDescription>
                    {role.description || "No description"}
                  </CardDescription>
                </div>
                <Badge variant="secondary">
                  {role.memberCount}{" "}
                  {role.memberCount === 1 ? "member" : "members"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-2">
                {role.permissions.map((permission) => (
                  <Badge key={permission} variant="outline">
                    {query.data.permissions.find(
                      (item) => item.key === permission,
                    )?.label ?? permission}
                  </Badge>
                ))}
                {!role.permissions.length && (
                  <span className="text-sm text-muted-foreground">
                    No permissions assigned
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditing(role)}>
                  Edit role
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${role.name}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${role.name}? Assigned members will return to standard member access.`,
                      )
                    ) {
                      remove.mutate(role.id);
                    }
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!query.isLoading && !query.data?.roles.length && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldCheckIcon />
            </EmptyMedia>
            <EmptyTitle>No Custom Roles Yet</EmptyTitle>
            <EmptyDescription>
              Create a role when standard owner, admin, and member access is too
              broad.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setEditing("new")}>
              <PlusIcon data-icon="inline-start" />
              Create Role
            </Button>
          </EmptyContent>
        </Empty>
      )}

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
            Team roles
          </h2>
          <p className="text-sm text-muted-foreground">
            Reusable roles assigned separately within each team.
          </p>
        </div>
        <Button variant="outline" onClick={() => setEditingTeamRole("new")}>
          <PlusIcon />
          Create team role
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {teamRoles.data?.roles.map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{role.name}</CardTitle>
                  <CardDescription>
                    {role.description || "No description"}
                  </CardDescription>
                </div>
                <Badge variant="secondary">
                  {role.assignmentCount} assignments
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap gap-2">
                {role.permissions.map((permission) => (
                  <Badge key={permission} variant="outline">
                    {teamRoles.data.permissions.find(
                      (item) => item.key === permission,
                    )?.label ?? permission}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setEditingTeamRole(role)}
                >
                  Edit role
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${role.name}`}
                  disabled={removeTeamRole.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${role.name}? Its team assignments will be removed.`,
                      )
                    ) {
                      removeTeamRole.mutate(role.id);
                    }
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <RoleDialog
        open={editing !== null}
        role={editing === "new" ? null : editing}
        permissions={query.data?.permissions ?? []}
        organizationSlug={organizationSlug}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
        scope="organization"
      />
      <RoleDialog
        open={editingTeamRole !== null}
        role={editingTeamRole === "new" ? null : editingTeamRole}
        permissions={teamRoles.data?.permissions ?? []}
        organizationSlug={organizationSlug}
        onOpenChange={(open) => !open && setEditingTeamRole(null)}
        onSaved={async () => {
          setEditingTeamRole(null);
          await queryClient.invalidateQueries({
            queryKey: ["organizations", organizationSlug, "team-roles"],
          });
        }}
        scope="team"
      />
    </div>
  );
}

function RoleDialog({
  open,
  role,
  permissions,
  organizationSlug,
  onOpenChange,
  onSaved,
  scope,
}: {
  open: boolean;
  role: OrganizationCustomRole | TeamRole | null;
  permissions: OrganizationPermission[];
  organizationSlug: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  scope: "organization" | "team";
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setSelected(role?.permissions ?? []);
  }, [role, open]);
  const grouped = useMemo(
    () =>
      permissions.reduce<Record<string, OrganizationPermission[]>>(
        (result, permission) => {
          (result[permission.group] ??= []).push(permission);
          return result;
        },
        {},
      ),
    [permissions],
  );
  const save = useMutation<unknown, Error>({
    mutationFn: () => {
      const input = { name, description, permissions: selected };
      if (scope === "team") {
        return role
          ? updateTeamRole(organizationSlug, role.id, input)
          : createTeamRole(organizationSlug, input);
      }
      return role
        ? updateOrganizationRole(organizationSlug, role.id, input)
        : createOrganizationRole(organizationSlug, input);
    },
    onSuccess: async () => {
      toast.success(
        role
          ? `${scope === "team" ? "Team" : "Custom"} role updated`
          : `${scope === "team" ? "Team" : "Custom"} role created`,
      );
      await onSaved();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {role
              ? `Edit ${role.name}`
              : `Create ${scope === "team" ? "team" : "custom"} role`}
          </DialogTitle>
          <DialogDescription>
            {scope === "team"
              ? "This role applies only in teams where it is assigned."
              : "Members receive these permissions plus basic member access."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="role-name">Role name</Label>
            <Input
              id="role-name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder="Example: Team manager"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="role-description">Description</Label>
            <Textarea
              id="role-description"
              value={description}
              maxLength={240}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe when this role should be used."
            />
          </div>
          {Object.entries(grouped).map(([group, items]) => (
            <fieldset key={group} className="rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">{group}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map((permission) => (
                  <label
                    key={permission.key}
                    className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selected.includes(permission.key)}
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked
                            ? [...current, permission.key]
                            : current.filter((key) => key !== permission.key),
                        )
                      }
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        {permission.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {permission.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <Button
            disabled={!name.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : role ? "Save changes" : "Create role"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
