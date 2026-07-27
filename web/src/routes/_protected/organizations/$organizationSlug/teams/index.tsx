import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArchiveIcon, PlusIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  archiveOrganizationTeam,
  createOrganizationTeam,
  hasOrganizationPermission,
  organizationTeamsQueryOptions,
  type OrganizationTeam,
} from "@/lib/organizations";

export const Route = createFileRoute(
  "/_protected/organizations/$organizationSlug/teams/",
)({ component: OrganizationTeams });

function OrganizationTeams() {
  const { organization } = Route.useRouteContext();
  const { organizationSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const query = useQuery(organizationTeamsQueryOptions(organizationSlug));
  const canCreate = hasOrganizationPermission(organization, "teams.create");
  const canUpdate = hasOrganizationPermission(organization, "teams.update");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<OrganizationTeam | null>(
    null,
  );
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["organizations", organizationSlug, "teams"],
    });
  const create = useMutation({
    mutationFn: () =>
      createOrganizationTeam(organizationSlug, {
        name,
        description,
        leadUserId: "",
      }),
    onSuccess: async () => {
      toast.success("Team created");
      setName("");
      setDescription("");
      setOpen(false);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });
  const archive = useMutation({
    mutationFn: (input: { id: string; archived: boolean }) =>
      archiveOrganizationTeam(organizationSlug, input.id, input.archived),
    onSuccess: async (_, input) => {
      toast.success(input.archived ? "Team archived" : "Team restored");
      setArchiveTarget(null);
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-semibold tracking-wide uppercase">
            Teams
          </h1>
          <p className="text-sm text-muted-foreground">
            Organize members into focused groups.
          </p>
        </div>
        {canCreate && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button />}>
              <PlusIcon /> Create team
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create team</DialogTitle>
                <DialogDescription>
                  You can assign members and a team lead afterward.
                </DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="team-name">Name</FieldLabel>
                  <Input
                    id="team-name"
                    name="name"
                    autoComplete="off"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="team-description">
                    Description
                  </FieldLabel>
                  <Input
                    id="team-description"
                    name="description"
                    autoComplete="off"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </Field>
                <Button
                  className="w-full"
                  disabled={!name || create.isPending}
                  onClick={() => create.mutate()}
                >
                  {create.isPending ? "Creating…" : "Create team"}
                </Button>
              </FieldGroup>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {query.data?.teams.map((team) => (
          <Card key={team.id} className={team.archivedAt ? "opacity-65" : ""}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle>{team.name}</CardTitle>
                  <CardDescription>
                    {team.description || "No description"}
                  </CardDescription>
                </div>
                {team.archivedAt && <Badge variant="outline">Archived</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <UsersIcon className="size-4" />
                {team.memberCount} members
                {team.leadName ? ` · Lead: ${team.leadName}` : ""}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  render={
                    <Link
                      to="/organizations/$organizationSlug/teams/$teamId"
                      params={{ organizationSlug, teamId: team.id }}
                    />
                  }
                >
                  Open team
                </Button>
                {canUpdate && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setArchiveTarget(team)}
                  >
                    <ArchiveIcon />
                    {team.archivedAt ? "Restore" : "Archive"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {!query.isPending && !query.data?.teams.length && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>No Teams Yet</EmptyTitle>
            <EmptyDescription>
              Create the first team to organize members into a focused group.
            </EmptyDescription>
          </EmptyHeader>
          {canCreate && (
            <EmptyContent>
              <Button onClick={() => setOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                Create Team
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archiveTarget?.archivedAt ? "Restore team?" : "Archive team?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget?.archivedAt
                ? "This makes the team editable again."
                : "Members remain assigned, but the team becomes read-only until restored."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={archive.isPending || !archiveTarget}
              onClick={() =>
                archiveTarget &&
                archive.mutate({
                  id: archiveTarget.id,
                  archived: !archiveTarget.archivedAt,
                })
              }
            >
              {archive.isPending
                ? "Working…"
                : archiveTarget?.archivedAt
                  ? "Restore team"
                  : "Archive team"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
