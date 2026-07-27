-- GC Go baseline schema.
CREATE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = (now() AT TIME ZONE 'UTC');
    RETURN NEW;
END;
$$;

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    image TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    role TEXT NOT NULL DEFAULT 'user',
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    ban_reason TEXT,
    ban_expires TIMESTAMP,
    deleted_at TIMESTAMP
);

CREATE UNIQUE INDEX users_email_lower_active_idx
    ON users (lower(email))
    WHERE deleted_at IS NULL;
CREATE INDEX users_deleted_at_idx ON users (deleted_at);

CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    logo TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    metadata TEXT,
    deleted_at TIMESTAMP
);

CREATE UNIQUE INDEX organizations_slug_lower_active_idx
    ON organizations (lower(slug))
    WHERE deleted_at IS NULL;
CREATE INDEX organizations_deleted_at_idx ON organizations (deleted_at);

CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    organization_id TEXT NOT NULL
        REFERENCES organizations (id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    description TEXT,
    lead_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
    archived_at TIMESTAMP
);

CREATE INDEX teams_organization_id_idx ON teams (organization_id);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    expires_at TIMESTAMP NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    ip_address TEXT,
    user_agent TEXT,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    impersonated_by TEXT,
    impersonation_reason TEXT,
    active_organization_id TEXT,
    active_team_id TEXT
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    id_token TEXT,
    access_token_expires_at TIMESTAMP,
    refresh_token_expires_at TIMESTAMP,
    scope TEXT,
    password TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

CREATE INDEX accounts_user_id_idx ON accounts (user_id);
CREATE UNIQUE INDEX accounts_provider_account_id_idx
    ON accounts (provider_id, account_id);

CREATE TABLE verifications (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

CREATE INDEX verifications_identifier_idx ON verifications (identifier);

CREATE TABLE two_factors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    backup_codes TEXT NOT NULL DEFAULT '[]',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

CREATE TABLE two_factor_challenges (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

CREATE INDEX two_factor_challenges_user_id_idx
    ON two_factor_challenges (user_id);
CREATE INDEX two_factor_challenges_expires_at_idx
    ON two_factor_challenges (expires_at);

CREATE TABLE members (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL
        REFERENCES organizations (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    UNIQUE (organization_id, user_id)
);

CREATE INDEX members_organization_id_idx ON members (organization_id);
CREATE INDEX members_user_id_idx ON members (user_id);

CREATE TABLE team_members (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    UNIQUE (team_id, user_id)
);

CREATE INDEX team_members_team_id_idx ON team_members (team_id);
CREATE INDEX team_members_user_id_idx ON team_members (user_id);

CREATE TABLE invitations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL
        REFERENCES organizations (id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT CHECK (role IN ('admin', 'member')),
    team_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    inviter_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token TEXT,
    invited_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
    accepted_at TIMESTAMP
);

CREATE INDEX invitations_organization_id_idx
    ON invitations (organization_id);
CREATE INDEX invitations_email_idx ON invitations (email);
CREATE UNIQUE INDEX invitations_token_idx
    ON invitations (token)
    WHERE token IS NOT NULL;

CREATE TABLE auth_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    target_type TEXT,
    target_id TEXT,
    reason TEXT,
    before_state JSONB,
    after_state JSONB,
    organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

CREATE INDEX auth_events_user_id_created_at_idx
    ON auth_events (user_id, created_at DESC);
CREATE INDEX auth_events_created_at_idx
    ON auth_events (created_at DESC);
CREATE INDEX auth_events_actor_created_idx
    ON auth_events (user_id, created_at DESC);
CREATE INDEX auth_events_target_idx
    ON auth_events (target_type, target_id, created_at DESC);
CREATE INDEX auth_events_organization_created_idx
    ON auth_events (organization_id, created_at DESC);

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER organizations_set_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER teams_set_updated_at
BEFORE UPDATE ON teams
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER sessions_set_updated_at
BEFORE UPDATE ON sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER accounts_set_updated_at
BEFORE UPDATE ON accounts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER verifications_set_updated_at
BEFORE UPDATE ON verifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER two_factors_set_updated_at
BEFORE UPDATE ON two_factors
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
