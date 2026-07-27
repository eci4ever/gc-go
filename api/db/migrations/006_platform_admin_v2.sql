ALTER TABLE users
ADD COLUMN deleted_at TIMESTAMP;

ALTER TABLE organizations
ADD COLUMN deleted_at TIMESTAMP;

ALTER TABLE sessions
ADD COLUMN impersonation_reason TEXT;

ALTER TABLE auth_events
ADD COLUMN target_type TEXT,
ADD COLUMN target_id TEXT,
ADD COLUMN reason TEXT,
ADD COLUMN before_state JSONB,
ADD COLUMN after_state JSONB;

ALTER TABLE invitations
ADD COLUMN token TEXT,
ADD COLUMN invited_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
ADD COLUMN accepted_at TIMESTAMP;

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE 'UNIQUE (email)%'
    LIMIT 1;
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', constraint_name);
    END IF;
END;
$$;
DROP INDEX IF EXISTS users_email_lower_idx;
CREATE UNIQUE INDEX users_email_lower_active_idx
    ON users (lower(email))
    WHERE deleted_at IS NULL;

DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'organizations'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE 'UNIQUE (slug)%'
    LIMIT 1;
    IF constraint_name IS NOT NULL THEN
        EXECUTE format(
            'ALTER TABLE organizations DROP CONSTRAINT %I',
            constraint_name
        );
    END IF;
END;
$$;
DROP INDEX IF EXISTS organizations_slug_lower_idx;
CREATE UNIQUE INDEX organizations_slug_lower_active_idx
    ON organizations (lower(slug))
    WHERE deleted_at IS NULL;

CREATE INDEX users_deleted_at_idx ON users (deleted_at);
CREATE INDEX organizations_deleted_at_idx ON organizations (deleted_at);
CREATE INDEX auth_events_actor_created_idx
    ON auth_events (user_id, created_at DESC);
CREATE INDEX auth_events_target_idx
    ON auth_events (target_type, target_id, created_at DESC);
CREATE UNIQUE INDEX invitations_token_idx
    ON invitations (token)
    WHERE token IS NOT NULL;
