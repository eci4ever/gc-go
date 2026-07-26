CREATE TABLE "user" (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    image TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    role TEXT,
    banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT,
    ban_expires TIMESTAMP
);

CREATE TABLE organization (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo TEXT,
    created_at TIMESTAMP NOT NULL,
    metadata TEXT
);

CREATE TABLE team (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    organization_id TEXT NOT NULL
        REFERENCES organization (id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP
);

CREATE INDEX team_organization_id_idx ON team (organization_id);

CREATE TABLE "session" (
    id TEXT PRIMARY KEY,
    expires_at TIMESTAMP NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    ip_address TEXT,
    user_agent TEXT,
    user_id TEXT NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE,
    impersonated_by TEXT,
    active_organization_id TEXT,
    active_team_id TEXT
);

CREATE INDEX session_user_id_idx ON "session" (user_id);

CREATE TABLE account (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at TIMESTAMP,
    refresh_token_expires_at TIMESTAMP,
    scope TEXT,
    password TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX account_user_id_idx ON account (user_id);

CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX verification_identifier_idx ON verification (identifier);

CREATE TABLE team_member (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL
        REFERENCES team (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE,
    created_at TIMESTAMP
);

CREATE INDEX team_member_team_id_idx ON team_member (team_id);
CREATE INDEX team_member_user_id_idx ON team_member (user_id);

CREATE TABLE member (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL
        REFERENCES organization (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TIMESTAMP NOT NULL
);

CREATE INDEX member_organization_id_idx ON member (organization_id);
CREATE INDEX member_user_id_idx ON member (user_id);

CREATE TABLE invitation (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL
        REFERENCES organization (id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT,
    team_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    inviter_id TEXT NOT NULL
        REFERENCES "user" (id) ON DELETE CASCADE
);

CREATE INDEX invitation_organization_id_idx
    ON invitation (organization_id);
CREATE INDEX invitation_email_idx ON invitation (email);

CREATE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER user_set_updated_at
BEFORE UPDATE ON "user"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER session_set_updated_at
BEFORE UPDATE ON "session"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER account_set_updated_at
BEFORE UPDATE ON account
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER verification_set_updated_at
BEFORE UPDATE ON verification
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER team_set_updated_at
BEFORE UPDATE ON team
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
