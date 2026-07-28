import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
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
  Field as FormField,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  hasOrganizationPermission,
  organizationMembersQueryOptions,
  transferOrganizationOwnership,
  updateOrganization,
} from "@/lib/organizations";

export const Route = createFileRoute(
  "/_protected/organizations/$organizationSlug/settings",
)({
  beforeLoad: ({ context }) => {
    if (
      !hasOrganizationPermission(
        context.organization,
        "organization.settings.update",
      )
    ) {
      throw redirect({
        to: "/organizations/$organizationSlug",
        params: { organizationSlug: context.organization.slug },
      });
    }
  },
  component: OrganizationSettings,
});

function OrganizationSettings() {
  const { organization } = Route.useRouteContext();
  const { organizationSlug } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const members = useQuery(organizationMembersQueryOptions(organizationSlug));
  const [name, setName] = useState(organization.name);
  const [slug, setSlug] = useState(organization.slug);
  const [logo, setLogo] = useState(organization.logo ?? "");
  const [metadata, setMetadata] = useState(organization.metadata ?? "");
  const [newOwnerId, setNewOwnerId] = useState("");
  const [reason, setReason] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const update = useMutation({
    mutationFn: () =>
      updateOrganization(organizationSlug, { name, slug, logo, metadata }),
    onSuccess: async () => {
      toast.success("Organization settings updated");
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      if (slug !== organizationSlug) {
        await navigate({
          to: "/organizations/$organizationSlug/settings",
          params: { organizationSlug: slug },
        });
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const transfer = useMutation({
    mutationFn: () =>
      transferOrganizationOwnership(organizationSlug, newOwnerId, reason),
    onSuccess: async () => {
      toast.success("Ownership transferred");
      setTransferOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["organizations"] });
      await navigate({
        to: "/organizations/$organizationSlug",
        params: { organizationSlug },
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const candidates =
    members.data?.members.filter((member) => member.role !== "owner") ?? [];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <PageHeader
        title="Organization Settings"
        description={`Identity and ownership controls for ${organization.name}.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Organization profile</CardTitle>
          <CardDescription>Update the workspace identity.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField>
            <FieldLabel htmlFor="organization-name">Name</FieldLabel>
            <Input
              id="organization-name"
              name="name"
              autoComplete="organization"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField>
            <FieldLabel htmlFor="organization-slug">Slug</FieldLabel>
            <Input
              id="organization-slug"
              name="slug"
              autoComplete="off"
              spellCheck={false}
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </FormField>
          <FormField>
            <FieldLabel htmlFor="organization-logo">Logo URL</FieldLabel>
            <Input
              id="organization-logo"
              name="logo"
              type="url"
              autoComplete="url"
              value={logo}
              onChange={(event) => setLogo(event.target.value)}
            />
          </FormField>
          <FormField>
            <FieldLabel htmlFor="organization-metadata">Metadata</FieldLabel>
            <Input
              id="organization-metadata"
              name="metadata"
              autoComplete="off"
              value={metadata}
              onChange={(event) => setMetadata(event.target.value)}
            />
          </FormField>
          <div className="sm:col-span-2">
            <Button
              disabled={!name || !slug || update.isPending}
              onClick={() => update.mutate()}
            >
              {update.isPending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </CardContent>
      </Card>
      {organization.role === "owner" && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Ownership</CardTitle>
            <CardDescription>
              The new owner receives full control. Your role becomes admin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
              <DialogTrigger render={<Button variant="destructive" />}>
                Transfer ownership
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Transfer organization ownership</DialogTitle>
                  <DialogDescription>
                    This action changes your role to admin.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Field label="New owner">
                    <Select
                      value={newOwnerId}
                      onValueChange={(value) => setNewOwnerId(value ?? "")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select member" />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((member) => (
                          <SelectItem key={member.userId} value={member.userId}>
                            {member.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Reason">
                    <Input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </Field>
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={!newOwnerId || !reason || transfer.isPending}
                    onClick={() => transfer.mutate()}
                  >
                    Confirm transfer
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <FormField>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </FormField>
  );
}
