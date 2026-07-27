CREATE TABLE organization_roles (
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

CREATE INDEX organization_roles_organization_id_idx
    ON organization_roles (organization_id);

CREATE TABLE organization_role_permissions (
    role_id TEXT NOT NULL REFERENCES organization_roles (id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    PRIMARY KEY (role_id, permission_key)
);

ALTER TABLE members
    ADD COLUMN custom_role_id TEXT
        REFERENCES organization_roles (id) ON DELETE SET NULL;

CREATE INDEX members_custom_role_id_idx ON members (custom_role_id);

CREATE TRIGGER organization_roles_set_updated_at
BEFORE UPDATE ON organization_roles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
