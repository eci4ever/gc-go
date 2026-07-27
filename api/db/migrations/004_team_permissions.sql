CREATE TABLE team_roles (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL
        REFERENCES organizations (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    UNIQUE (organization_id, name)
);

CREATE INDEX team_roles_organization_id_idx ON team_roles (organization_id);

CREATE TABLE team_role_permissions (
    role_id TEXT NOT NULL REFERENCES team_roles (id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE team_member_roles (
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL REFERENCES team_roles (id) ON DELETE CASCADE,
    assigned_by TEXT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    assigned_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id, user_id)
        REFERENCES team_members (team_id, user_id) ON DELETE CASCADE
);

CREATE INDEX team_member_roles_role_id_idx ON team_member_roles (role_id);

CREATE TRIGGER team_roles_set_updated_at
BEFORE UPDATE ON team_roles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
