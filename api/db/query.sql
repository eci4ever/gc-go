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
    accounts.password,
    coalesce(two_factors.enabled, FALSE) AS two_factor_enabled
FROM users
JOIN accounts ON accounts.user_id = users.id
LEFT JOIN two_factors ON two_factors.user_id = users.id
WHERE lower(users.email) = lower($1)
  AND accounts.provider_id = 'credential'
LIMIT 1;

-- name: UpsertPendingTwoFactor :one
INSERT INTO two_factors (
    id,
    user_id,
    secret,
    backup_codes,
    enabled
) VALUES (
    $1,
    $2,
    $3,
    '[]',
    FALSE
)
ON CONFLICT (user_id) DO UPDATE
SET
    secret = excluded.secret,
    backup_codes = '[]',
    enabled = FALSE
RETURNING *;

-- name: GetTwoFactorByUserID :one
SELECT *
FROM two_factors
WHERE user_id = $1;

-- name: EnableTwoFactor :exec
UPDATE two_factors
SET
    enabled = TRUE,
    backup_codes = $2
WHERE user_id = $1;

-- name: UpdateTwoFactorBackupCodes :exec
UPDATE two_factors
SET backup_codes = $2
WHERE user_id = $1;

-- name: DeleteTwoFactor :exec
DELETE FROM two_factors
WHERE user_id = $1;

-- name: CreateTwoFactorChallenge :exec
INSERT INTO two_factor_challenges (
    id,
    token,
    user_id,
    expires_at
) VALUES (
    $1,
    $2,
    $3,
    $4
);

-- name: GetTwoFactorChallenge :one
SELECT
    two_factor_challenges.id AS challenge_id,
    two_factor_challenges.user_id,
    two_factors.secret,
    two_factors.backup_codes,
    users.name,
    users.email,
    users.email_verified,
    users.image,
    users.role
FROM two_factor_challenges
JOIN two_factors
    ON two_factors.user_id = two_factor_challenges.user_id
   AND two_factors.enabled = TRUE
JOIN users ON users.id = two_factor_challenges.user_id
WHERE two_factor_challenges.token = $1
  AND two_factor_challenges.expires_at > (now() AT TIME ZONE 'UTC')
  AND coalesce(users.banned, FALSE) = FALSE
LIMIT 1;

-- name: DeleteTwoFactorChallenge :exec
DELETE FROM two_factor_challenges
WHERE id = $1;

-- name: CreateSession :one
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
)
RETURNING *;

-- name: GetSessionUser :one
SELECT
    sessions.id AS session_id,
    sessions.expires_at,
    sessions.created_at,
    sessions.updated_at,
    sessions.ip_address,
    sessions.user_agent,
    sessions.user_id,
    sessions.impersonated_by,
    sessions.active_organization_id,
    sessions.active_team_id,
    users.name AS user_name,
    users.email AS user_email,
    users.email_verified AS user_email_verified,
    users.image AS user_image,
    users.role AS user_role
FROM sessions
JOIN users ON users.id = sessions.user_id
WHERE sessions.token = $1
  AND sessions.expires_at > (now() AT TIME ZONE 'UTC')
  AND coalesce(users.banned, FALSE) = FALSE
LIMIT 1;

-- name: DeleteSession :exec
DELETE FROM sessions
WHERE token = $1;

-- name: UpdateUserProfile :one
UPDATE users
SET
    name = $2,
    image = $3,
    updated_at = (now() AT TIME ZONE 'UTC')
WHERE id = $1
RETURNING *;

-- name: GetCredentialPasswordByUserID :one
SELECT password
FROM accounts
WHERE user_id = $1
  AND provider_id = 'credential'
LIMIT 1;

-- name: UpdateCredentialPassword :exec
UPDATE accounts
SET
    password = $2,
    updated_at = (now() AT TIME ZONE 'UTC')
WHERE user_id = $1
  AND provider_id = 'credential';

-- name: DeleteOtherUserSessions :exec
DELETE FROM sessions
WHERE user_id = $1
  AND token <> $2;

-- name: ListUserSessions :many
SELECT
    id,
    expires_at,
    created_at,
    updated_at,
    ip_address,
    user_agent,
    user_id,
    impersonated_by,
    active_organization_id,
    active_team_id,
    token = $2 AS is_current
FROM sessions
WHERE user_id = $1
  AND expires_at > (now() AT TIME ZONE 'UTC')
ORDER BY created_at DESC;

-- name: RevokeUserSession :one
DELETE FROM sessions
WHERE id = $1
  AND user_id = $2
  AND token <> $3
RETURNING id;

-- name: CreateAuthEvent :exec
INSERT INTO auth_events (
    id,
    user_id,
    event_type,
    ip_address,
    user_agent
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5
);

-- name: CountActiveUserSessions :one
SELECT count(*)::integer
FROM sessions
WHERE user_id = $1
  AND expires_at > (now() AT TIME ZONE 'UTC');

-- name: GetUserSignInActivity :many
SELECT
    days.day::date AS day,
    count(auth_events.id)::integer AS sign_ins
FROM generate_series(
    ((now() AT TIME ZONE 'UTC')::date - interval '13 days')::date,
    (now() AT TIME ZONE 'UTC')::date,
    interval '1 day'
) AS days(day)
LEFT JOIN auth_events
    ON auth_events.user_id = $1
   AND auth_events.event_type IN ('login_success', 'two_factor_success')
   AND auth_events.created_at >= days.day
   AND auth_events.created_at < days.day + interval '1 day'
GROUP BY days.day
ORDER BY days.day;
