import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ActivityIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  hasOrganizationPermission,
  organizationAuditQueryOptions,
} from "@/lib/organizations";

export const Route = createFileRoute(
  "/_protected/organizations/$organizationSlug/audit",
)({
  beforeLoad: ({ context }) => {
    if (!hasOrganizationPermission(context.organization, "audit_log.read")) {
      throw redirect({
        to: "/organizations/$organizationSlug",
        params: { organizationSlug: context.organization.slug },
      });
    }
  },
  component: OrganizationAudit,
});

function OrganizationAudit() {
  const { organizationSlug } = Route.useParams();
  const [page, setPage] = useState(1);
  const query = useQuery(organizationAuditQueryOptions(organizationSlug, page));
  const pagination = query.data?.pagination;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div>
        <h1 className="font-heading text-xl font-semibold tracking-wide uppercase">
          Organization audit
        </h1>
        <p className="text-sm text-muted-foreground">
          Security-sensitive changes made within this workspace.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            {pagination?.total ?? 0} recorded events
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {query.data?.events.map((event) => (
            <div
              key={event.id}
              className="grid gap-1 px-6 py-4 sm:grid-cols-[1fr_auto]"
            >
              <div>
                <p className="text-sm font-medium">
                  {event.eventType.replaceAll("_", " ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {event.actorName || event.actorEmail || "System"}
                  {event.targetType ? ` · ${event.targetType}` : ""}
                  {event.reason ? ` · ${event.reason}` : ""}
                </p>
              </div>
              <time className="text-xs text-muted-foreground">
                {new Date(event.createdAt).toLocaleString()}
              </time>
            </div>
          ))}
          {!query.isPending && !query.data?.events.length && (
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ActivityIcon />
                </EmptyMedia>
                <EmptyTitle>No Activity Yet</EmptyTitle>
                <EmptyDescription>
                  Security-sensitive organization events will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={
            !pagination || page * pagination.pageSize >= pagination.total
          }
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
