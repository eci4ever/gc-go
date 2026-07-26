CREATE TABLE two_factors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE
        REFERENCES users (id) ON DELETE CASCADE,
    secret TEXT NOT NULL,
    backup_codes TEXT NOT NULL DEFAULT '[]',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE two_factor_challenges (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL
        REFERENCES users (id) ON DELETE CASCADE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX two_factor_challenges_user_id_idx
    ON two_factor_challenges (user_id);
CREATE INDEX two_factor_challenges_expires_at_idx
    ON two_factor_challenges (expires_at);

CREATE TRIGGER two_factors_set_updated_at
BEFORE UPDATE ON two_factors
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
