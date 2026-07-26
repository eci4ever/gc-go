UPDATE users
SET role = 'user'
WHERE role IS NULL;

ALTER TABLE users
    ALTER COLUMN role SET DEFAULT 'user',
    ALTER COLUMN role SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_account_id_idx
    ON accounts (provider_id, account_id);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
    ON users (lower(email));

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
    ON sessions (expires_at);
