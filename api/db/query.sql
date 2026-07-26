-- name: Ping :one
SELECT 1::integer AS value;

-- name: CreateUser :one
INSERT INTO users (
    id,
    name,
    email
) VALUES (
    $1,
    $2,
    $3
)
RETURNING *;

-- name: CreateCredentialAccount :exec
INSERT INTO accounts (
    id,
    account_id,
    provider_id,
    user_id,
    password
) VALUES (
    $1,
    $2,
    'credential',
    $3,
    $4
);

-- name: GetCredentialUserByEmail :one
SELECT
    users.id,
    users.name,
    users.email,
    users.email_verified,
    users.image,
    users.role,
    users.banned,
    users.ban_reason,
    users.ban_expires,
    accounts.password
FROM users
JOIN accounts ON accounts.user_id = users.id
WHERE lower(users.email) = lower($1)
  AND accounts.provider_id = 'credential'
LIMIT 1;

-- name: CreateSession :exec
INSERT INTO sessions (
    id,
    expires_at,
    token,
    ip_address,
    user_agent,
    user_id
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6
);

-- name: GetSessionUser :one
SELECT
    users.id,
    users.name,
    users.email,
    users.email_verified,
    users.image,
    users.role
FROM sessions
JOIN users ON users.id = sessions.user_id
WHERE sessions.token = $1
  AND sessions.expires_at > (now() AT TIME ZONE 'UTC')
  AND coalesce(users.banned, FALSE) = FALSE
LIMIT 1;

-- name: DeleteSession :exec
DELETE FROM sessions
WHERE token = $1;
