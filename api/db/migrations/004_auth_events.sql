CREATE TABLE auth_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL
        REFERENCES users (id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX auth_events_user_id_created_at_idx
    ON auth_events (user_id, created_at DESC);
CREATE INDEX auth_events_created_at_idx
    ON auth_events (created_at DESC);
