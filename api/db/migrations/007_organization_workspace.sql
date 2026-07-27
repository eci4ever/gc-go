ALTER TABLE organizations
ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC');

ALTER TABLE teams
ADD COLUMN description TEXT,
ADD COLUMN lead_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
ADD COLUMN archived_at TIMESTAMP;

ALTER TABLE auth_events
ADD COLUMN organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL;

CREATE INDEX auth_events_organization_created_idx
    ON auth_events (organization_id, created_at DESC);

CREATE UNIQUE INDEX team_members_team_user_idx
    ON team_members (team_id, user_id);

ALTER TABLE members
ADD CONSTRAINT members_role_check
CHECK (role IN ('owner', 'admin', 'member'));

ALTER TABLE invitations
ADD CONSTRAINT invitations_role_check
CHECK (role IN ('admin', 'member'));

CREATE TRIGGER organizations_set_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
