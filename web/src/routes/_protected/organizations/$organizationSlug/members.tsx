import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cancelOrganizationInvitation,
  inviteOrganizationMember,
  hasOrganizationPermission,
  organizationMembersQueryOptions,
  organizationRolesQueryOptions,
  removeOrganizationMember,
  updateOrganizationMember,
} from "@/lib/organizations";

export const Route = createFileRoute(
  "/_protected/organizations/$organizationSlug/members",
)({ component: OrganizationMembers });

function OrganizationMembers() {
  const { organization } = Route.useRouteContext();
  const { organizationSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const query = useQuery(organizationMembersQueryOptions(organizationSlug));
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const canInvite = hasOrganizationPermission(organization, "members.invite");
  const canRemove = hasOrganizationPermission(organization, "members.remove");
  const canChangeRoles = hasOrganizationPermission(
    organization,
    "members.role.update",
  );
  const roles = useQuery({
    ...organizationRolesQueryOptions(organizationSlug),
    enabled: canChangeRoles,
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["organizations", organizationSlug, "members"],
    });
  const invite = useMutation({
    mutationFn: () =>
      inviteOrganizationMember(organizationSlug, { email, role }),
    onSuccess: async () => {
      toast.success("Invitation sent");
      setEmail("");
      setOpen(false);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const updateRole = useMutation({
    mutationFn: (input: { userId: string; value: string }) =>
      updateOrganizationMember(
        organizationSlug,
        input.userId,
        input.value.startsWith("custom:")
          ? ""
          : (input.value as "admin" | "member"),
        input.value.startsWith("custom:") ? input.value.slice(7) : "",
      ),
    onSuccess: async () => {
      toast.success("Member role updated");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (userId: string) =>
      removeOrganizationMember(organizationSlug, userId),
    onSuccess: async () => {
      toast.success("Member removed");
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      cancelOrganizationInvitation(organizationSlug, id),
    onSuccess: refresh,
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-wide uppercase">
            Members
          </h1>
          <p className="text-sm text-muted-foreground">
            People with access to {organization.name}.
          </p>
        </div>
        {canInvite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}>Invite member</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite to organization</DialogTitle>
                <DialogDescription>
                  Invitations expire after seven days.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={role}
                    onValueChange={(value) => setRole(value as typeof role)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      {organization.role === "owner" && (
                        <SelectItem value="admin">Admin</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  disabled={!email || invite.isPending}
                  onClick={() => invite.mutate()}
                >
                  {invite.isPending ? "Sending…" : "Send invitation"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Organization members</CardTitle>
          <CardDescription>
            {query.data?.members.length ?? 0} members
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {query.data?.members.map((member) => (
            <div
              key={member.id}
              className="flex flex-wrap items-center gap-3 px-6 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.email}
                </p>
              </div>
              <Badge variant="secondary">
                {member.customRoleName ?? member.role}
              </Badge>
              {canChangeRoles && member.role !== "owner" && (
                <Select
                  value={
                    member.customRoleId
                      ? `custom:${member.customRoleId}`
                      : member.role
                  }
                  onValueChange={(value) =>
                    updateRole.mutate({
                      userId: member.userId,
                      value: value ?? "member",
                    })
                  }
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                    {roles.data?.roles.map((role) => (
                      <SelectItem key={role.id} value={`custom:${role.id}`}>
                        {role.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {canRemove &&
                member.role !== "owner" &&
                !(organization.role === "admin" && member.role === "admin") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(member.userId)}
                  >
                    Remove
                  </Button>
                )}
            </div>
          ))}
        </CardContent>
      </Card>
      {(query.data?.invitations.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Invitations</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {query.data?.invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="flex items-center gap-3 px-6 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {invitation.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {invitation.role}
                  </p>
                </div>
                <Badge variant="outline">{invitation.status}</Badge>
                {canInvite && invitation.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => cancel.mutate(invitation.id)}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
