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

-- name: DeleteUserEmailVerifications :exec
DELETE FROM verifications
WHERE identifier = $1;

-- name: CreateEmailVerification :exec
INSERT INTO verifications (
    id,
    identifier,
    value,
    expires_at
) VALUES (
    $1,
    $2,
    $3,
    $4
);

-- name: GetActiveEmailVerification :one
SELECT
    verifications.id,
    verifications.identifier AS user_id
FROM verifications
JOIN users ON users.id = verifications.identifier
WHERE verifications.value = $1
  AND users.deleted_at IS NULL
  AND verifications.expires_at > (now() AT TIME ZONE 'UTC')
  AND users.email_verified = FALSE
LIMIT 1
FOR UPDATE;

-- name: GetRecentEmailVerification :one
SELECT created_at
FROM verifications
WHERE identifier = $1
  AND created_at > (now() AT TIME ZONE 'UTC') - INTERVAL '60 seconds'
ORDER BY created_at DESC
LIMIT 1;

-- name: MarkUserEmailVerified :exec
UPDATE users
SET email_verified = TRUE
WHERE id = $1;

-- name: DeleteEmailVerification :exec
DELETE FROM verifications
WHERE id = $1;

-- name: GetPasswordResetUserByEmail :one
SELECT
    users.id,
    users.name,
    users.email
FROM users
JOIN accounts
    ON accounts.user_id = users.id
   AND accounts.provider_id = 'credential'
WHERE lower(users.email) = lower($1)
  AND users.deleted_at IS NULL
  AND NOT (
      coalesce(users.banned, FALSE)
      AND (users.ban_expires IS NULL OR users.ban_expires > (now() AT TIME ZONE 'UTC'))
  )
LIMIT 1;

-- name: GetActivePasswordReset :one
SELECT
    verifications.id,
    users.id AS user_id,
    accounts.password
FROM verifications
JOIN users ON lower(users.email) = lower(verifications.identifier)
JOIN accounts
    ON accounts.user_id = users.id
   AND accounts.provider_id = 'credential'
WHERE verifications.value = $1
  AND users.deleted_at IS NULL
  AND verifications.expires_at > (now() AT TIME ZONE 'UTC')
  AND NOT (
      coalesce(users.banned, FALSE)
      AND (users.ban_expires IS NULL OR users.ban_expires > (now() AT TIME ZONE 'UTC'))
  )
LIMIT 1
FOR UPDATE;

-- name: DeleteAllUserSessions :exec
DELETE FROM sessions
WHERE user_id = $1;

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
  AND users.deleted_at IS NULL
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
  AND users.deleted_at IS NULL
  AND two_factor_challenges.expires_at > (now() AT TIME ZONE 'UTC')
  AND NOT (
      coalesce(users.banned, FALSE)
      AND (users.ban_expires IS NULL OR users.ban_expires > (now() AT TIME ZONE 'UTC'))
  )
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
    sessions.impersonation_reason,
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
  AND users.deleted_at IS NULL
  AND sessions.expires_at > (now() AT TIME ZONE 'UTC')
  AND NOT (
      coalesce(users.banned, FALSE)
      AND (users.ban_expires IS NULL OR users.ban_expires > (now() AT TIME ZONE 'UTC'))
  )
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
  AND deleted_at IS NULL
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

-- name: AdminListUsers :many
SELECT
    users.id,
    users.name,
    users.email,
    users.email_verified,
    users.image,
    users.role,
    coalesce((
        coalesce(users.banned, FALSE)
        AND (users.ban_expires IS NULL OR users.ban_expires > (now() AT TIME ZONE 'UTC'))
    ), FALSE)::boolean AS banned,
    users.ban_reason,
    users.ban_expires,
    users.deleted_at,
    users.created_at,
    count(DISTINCT sessions.id)::integer AS active_sessions,
    count(DISTINCT members.organization_id)::integer AS organization_count
FROM users
LEFT JOIN sessions
    ON sessions.user_id = users.id
   AND sessions.expires_at > (now() AT TIME ZONE 'UTC')
LEFT JOIN members ON members.user_id = users.id
WHERE (
    sqlc.arg(include_deleted)::boolean
    OR users.deleted_at IS NULL
)
AND (
    sqlc.arg(search)::text = ''
    OR users.name ILIKE '%' || sqlc.arg(search)::text || '%'
    OR users.email ILIKE '%' || sqlc.arg(search)::text || '%'
)
AND (
    sqlc.arg(role)::text = ''
    OR users.role = sqlc.arg(role)::text
)
AND (
    sqlc.arg(status)::text = ''
    OR (
        sqlc.arg(status)::text = 'active'
        AND users.deleted_at IS NULL
        AND NOT (
            coalesce(users.banned, FALSE)
            AND (users.ban_expires IS NULL OR users.ban_expires > (now() AT TIME ZONE 'UTC'))
        )
    )
    OR (
        sqlc.arg(status)::text = 'banned'
        AND users.deleted_at IS NULL
        AND coalesce(users.banned, FALSE)
        AND (users.ban_expires IS NULL OR users.ban_expires > (now() AT TIME ZONE 'UTC'))
    )
    OR (sqlc.arg(status)::text = 'deleted' AND users.deleted_at IS NOT NULL)
)
GROUP BY users.id
ORDER BY users.created_at DESC
LIMIT sqlc.arg(page_size)::integer
OFFSET sqlc.arg(page_offset)::integer;

-- name: AdminCountUsers :one
SELECT count(*)::integer
FROM users
WHERE (
    sqlc.arg(include_deleted)::boolean
    OR users.deleted_at IS NULL
)
AND (
    sqlc.arg(search)::text = ''
    OR users.name ILIKE '%' || sqlc.arg(search)::text || '%'
    OR users.email ILIKE '%' || sqlc.arg(search)::text || '%'
)
AND (
    sqlc.arg(role)::text = ''
    OR users.role = sqlc.arg(role)::text
)
AND (
    sqlc.arg(status)::text = ''
    OR (
        sqlc.arg(status)::text = 'active'
        AND users.deleted_at IS NULL
        AND NOT (
            coalesce(users.banned, FALSE)
            AND (users.ban_expires IS NULL OR users.ban_expires > (now() AT TIME ZONE 'UTC'))
        )
    )
    OR (
        sqlc.arg(status)::text = 'banned'
        AND users.deleted_at IS NULL
        AND coalesce(users.banned, FALSE)
        AND (users.ban_expires IS NULL OR users.ban_expires > (now() AT TIME ZONE 'UTC'))
    )
    OR (sqlc.arg(status)::text = 'deleted' AND users.deleted_at IS NOT NULL)
);

-- name: AdminCreateUser :one
INSERT INTO users (
    id,
    name,
    email,
    email_verified,
    image,
    role
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6
)
RETURNING *;

-- name: AdminUpdateUser :one
UPDATE users
SET
    name = $2,
    email_verified = CASE
        WHEN lower(email) <> lower($3) THEN FALSE
        ELSE $4
    END,
    email = $3,
    image = $5,
    role = $6
WHERE id = $1
  AND deleted_at IS NULL
RETURNING *;

-- name: AdminSetUserBan :one
UPDATE users
SET
    banned = $2,
    ban_reason = $3,
    ban_expires = $4
WHERE id = $1
  AND deleted_at IS NULL
RETURNING *;

-- name: AdminGetUser :one
SELECT *
FROM users
WHERE id = $1;

-- name: AdminSoftDeleteUser :one
UPDATE users
SET deleted_at = (now() AT TIME ZONE 'UTC')
WHERE id = $1
  AND deleted_at IS NULL
RETURNING *;

-- name: AdminRestoreUser :one
UPDATE users
SET deleted_at = NULL
WHERE id = $1
  AND deleted_at IS NOT NULL
RETURNING *;

-- name: AdminCountUsersByRole :one
SELECT count(*)::integer
FROM users
WHERE role = $1
  AND deleted_at IS NULL;

-- name: AdminCountOwnedOrganizations :one
SELECT count(*)::integer
FROM members
JOIN organizations ON organizations.id = members.organization_id
WHERE user_id = $1
  AND role = 'owner'
  AND organizations.deleted_at IS NULL;

-- name: CreateImpersonatedSession :one
INSERT INTO sessions (
    id,
    expires_at,
    token,
    ip_address,
    user_agent,
    user_id,
    impersonated_by,
    impersonation_reason
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8
)
RETURNING *;

-- name: AdminListOrganizations :many
SELECT
    organizations.id,
    organizations.name,
    organizations.slug,
    organizations.logo,
    organizations.created_at,
    organizations.metadata,
    organizations.deleted_at,
    owners.id AS owner_id,
    owners.name AS owner_name,
    owners.email AS owner_email,
    count(DISTINCT members.user_id)::integer AS member_count
FROM organizations
LEFT JOIN members ON members.organization_id = organizations.id
LEFT JOIN members AS owner_members
    ON owner_members.organization_id = organizations.id
   AND owner_members.role = 'owner'
LEFT JOIN users AS owners ON owners.id = owner_members.user_id
WHERE (
    sqlc.arg(include_deleted)::boolean
    OR organizations.deleted_at IS NULL
)
AND (
    sqlc.arg(search)::text = ''
    OR organizations.name ILIKE '%' || sqlc.arg(search)::text || '%'
    OR organizations.slug ILIKE '%' || sqlc.arg(search)::text || '%'
)
GROUP BY organizations.id, owners.id
ORDER BY organizations.created_at DESC
LIMIT sqlc.arg(page_size)::integer
OFFSET sqlc.arg(page_offset)::integer;

-- name: AdminCountOrganizations :one
SELECT count(*)::integer
FROM organizations
WHERE (
    sqlc.arg(include_deleted)::boolean
    OR deleted_at IS NULL
)
AND (
    sqlc.arg(search)::text = ''
    OR name ILIKE '%' || sqlc.arg(search)::text || '%'
    OR slug ILIKE '%' || sqlc.arg(search)::text || '%'
);

-- name: AdminCreateOrganization :one
INSERT INTO organizations (
    id,
    name,
    slug,
    logo,
    created_at,
    metadata
) VALUES (
    $1,
    $2,
    $3,
    $4,
    (now() AT TIME ZONE 'UTC'),
    $5
)
RETURNING *;

-- name: AdminUpdateOrganization :one
UPDATE organizations
SET
    name = $2,
    slug = $3,
    logo = $4,
    metadata = $5
WHERE id = $1
  AND deleted_at IS NULL
RETURNING *;

-- name: AdminSoftDeleteOrganization :one
UPDATE organizations
SET deleted_at = (now() AT TIME ZONE 'UTC')
WHERE id = $1
  AND deleted_at IS NULL
RETURNING *;

-- name: AdminRestoreOrganization :one
UPDATE organizations
SET deleted_at = NULL
WHERE id = $1
  AND deleted_at IS NOT NULL
RETURNING *;

-- name: AdminGetOrganization :one
SELECT *
FROM organizations
WHERE id = $1;

-- name: AdminDemoteOrganizationOwners :exec
UPDATE members
SET role = 'member'
WHERE organization_id = $1
  AND role = 'owner';

-- name: AdminUpsertOrganizationOwner :exec
INSERT INTO members (
    id,
    organization_id,
    user_id,
    role,
    created_at
) VALUES (
    $1,
    $2,
    $3,
    'owner',
    (now() AT TIME ZONE 'UTC')
)
ON CONFLICT (organization_id, user_id) DO UPDATE
SET role = 'owner';

-- name: AdminListOrganizationMembers :many
SELECT
    members.id,
    members.role,
    members.created_at,
    users.id AS user_id,
    users.name,
    users.email,
    users.image,
    users.banned,
    users.deleted_at
FROM members
JOIN users ON users.id = members.user_id
WHERE members.organization_id = $1
ORDER BY
    CASE members.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
    users.name;

-- name: AdminUpsertOrganizationMember :exec
INSERT INTO members (
    id,
    organization_id,
    user_id,
    role,
    created_at
) VALUES (
    $1,
    $2,
    $3,
    $4,
    (now() AT TIME ZONE 'UTC')
)
ON CONFLICT (organization_id, user_id) DO UPDATE
SET role = excluded.role;

-- name: AdminGetOrganizationMember :one
SELECT *
FROM members
WHERE organization_id = $1
  AND user_id = $2;

-- name: AdminDeleteOrganizationMember :one
DELETE FROM members
WHERE organization_id = $1
  AND user_id = $2
RETURNING *;

-- name: AdminListOrganizationInvitations :many
SELECT
    invitations.id,
    invitations.email,
    invitations.role,
    invitations.status,
    invitations.expires_at,
    invitations.created_at,
    invitations.invited_user_id,
    invitations.team_id,
    teams.name AS team_name
FROM invitations
LEFT JOIN teams ON teams.id = invitations.team_id
WHERE invitations.organization_id = $1
ORDER BY invitations.created_at DESC;

-- name: GetPendingOrganizationInvitation :one
SELECT id
FROM invitations
WHERE organization_id = $1
  AND lower(email) = lower(sqlc.arg(email)::text)
  AND team_id IS NOT DISTINCT FROM sqlc.narg(team_id)::text
  AND status = 'pending'
  AND expires_at > (now() AT TIME ZONE 'UTC')
LIMIT 1;

-- name: LockOrganizationForInvitation :one
SELECT id
FROM organizations
WHERE id = $1
  AND deleted_at IS NULL
FOR UPDATE;

-- name: AdminCreateOrganizationInvitation :one
INSERT INTO invitations (
    id,
    organization_id,
    email,
    role,
    status,
    expires_at,
    inviter_id,
    token,
    invited_user_id,
    team_id
) VALUES (
    $1,
    $2,
    $3,
    $4,
    'pending',
    $5,
    $6,
    $7,
    $8,
    $9
)
RETURNING *;

-- name: GetOrganizationInvitationForAcceptance :one
SELECT
    invitations.id,
    invitations.organization_id,
    invitations.role,
    invitations.team_id,
    invitations.status,
    invitations.expires_at,
    invitations.invited_user_id,
    organizations.name AS organization_name
FROM invitations
JOIN organizations ON organizations.id = invitations.organization_id
WHERE invitations.token = sqlc.arg(token)::text
  AND lower(invitations.email) = lower(sqlc.arg(email)::text)
  AND organizations.deleted_at IS NULL
LIMIT 1
FOR UPDATE;

-- name: AcceptOrganizationInvitation :exec
UPDATE invitations
SET
    status = 'accepted',
    accepted_at = (now() AT TIME ZONE 'UTC'),
    invited_user_id = $2
WHERE id = $1;

-- name: AdminCancelOrganizationInvitation :one
UPDATE invitations
SET status = 'cancelled'
WHERE id = $1
  AND organization_id = $2
  AND status = 'pending'
RETURNING id;

-- name: CreateAuthEvent :exec
INSERT INTO auth_events (
    id,
    user_id,
    event_type,
    ip_address,
    user_agent,
    target_type,
    target_id,
    reason,
    before_state,
    after_state
) VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9,
    $10
);

-- name: AdminListAuditEvents :many
SELECT
    auth_events.id,
    auth_events.event_type,
    auth_events.created_at,
    auth_events.ip_address,
    auth_events.user_agent,
    auth_events.target_type,
    auth_events.target_id,
    auth_events.reason,
    auth_events.before_state,
    auth_events.after_state,
    actors.id AS actor_id,
    actors.name AS actor_name,
    actors.email AS actor_email
FROM auth_events
JOIN users AS actors ON actors.id = auth_events.user_id
WHERE (
    sqlc.arg(search)::text = ''
    OR actors.name ILIKE '%' || sqlc.arg(search)::text || '%'
    OR actors.email ILIKE '%' || sqlc.arg(search)::text || '%'
    OR auth_events.event_type ILIKE '%' || sqlc.arg(search)::text || '%'
    OR coalesce(auth_events.target_id, '') ILIKE '%' || sqlc.arg(search)::text || '%'
)
ORDER BY auth_events.created_at DESC
LIMIT sqlc.arg(page_size)::integer
OFFSET sqlc.arg(page_offset)::integer;

-- name: AdminCountAuditEvents :one
SELECT count(*)::integer
FROM auth_events
JOIN users AS actors ON actors.id = auth_events.user_id
WHERE (
    sqlc.arg(search)::text = ''
    OR actors.name ILIKE '%' || sqlc.arg(search)::text || '%'
    OR actors.email ILIKE '%' || sqlc.arg(search)::text || '%'
    OR auth_events.event_type ILIKE '%' || sqlc.arg(search)::text || '%'
    OR coalesce(auth_events.target_id, '') ILIKE '%' || sqlc.arg(search)::text || '%'
);

-- name: AdminDashboardMetrics :one
SELECT
    (SELECT count(*)::integer FROM users WHERE deleted_at IS NULL) AS total_users,
    (
        SELECT count(*)::integer
        FROM users
        WHERE deleted_at IS NULL
          AND coalesce(banned, FALSE)
          AND (ban_expires IS NULL OR ban_expires > (now() AT TIME ZONE 'UTC'))
    ) AS banned_users,
    (SELECT count(*)::integer FROM users WHERE deleted_at IS NULL AND email_verified) AS verified_users,
    (SELECT count(*)::integer FROM organizations WHERE deleted_at IS NULL) AS total_organizations,
    (SELECT count(*)::integer FROM sessions WHERE expires_at > (now() AT TIME ZONE 'UTC')) AS active_sessions,
    (SELECT count(*)::integer FROM invitations WHERE status = 'pending' AND expires_at > (now() AT TIME ZONE 'UTC')) AS pending_invitations;

-- name: AdminUserGrowth :many
SELECT
    days.day::date AS day,
    count(users.id)::integer AS users
FROM generate_series(
    ((now() AT TIME ZONE 'UTC')::date - interval '29 days')::date,
    (now() AT TIME ZONE 'UTC')::date,
    interval '1 day'
) AS days(day)
LEFT JOIN users
    ON users.created_at >= days.day
   AND users.created_at < days.day + interval '1 day'
GROUP BY days.day
ORDER BY days.day;

-- name: ListUserOrganizations :many
SELECT
    organizations.id, organizations.name, organizations.slug,
    organizations.logo, organizations.metadata, members.role,
    organizations.created_at, organizations.updated_at
FROM members
JOIN organizations ON organizations.id = members.organization_id
WHERE members.user_id = $1 AND organizations.deleted_at IS NULL
ORDER BY organizations.name;

-- name: GetOrganizationMembership :one
SELECT
    organizations.id, organizations.name, organizations.slug,
    organizations.logo, organizations.metadata, organizations.created_at,
    organizations.updated_at, members.role,
    members.created_at AS member_since
FROM members
JOIN organizations ON organizations.id = members.organization_id
WHERE organizations.slug = $1 AND members.user_id = $2
  AND organizations.deleted_at IS NULL;

-- name: SetSessionActiveOrganization :exec
UPDATE sessions
SET active_organization_id = $2, active_team_id = NULL
WHERE id = $1 AND user_id = $3;

-- name: UpdateOrganizationWorkspace :one
UPDATE organizations
SET name = $2, slug = $3, logo = $4, metadata = $5
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: ListOrganizationMembers :many
SELECT
    members.id, members.role, members.created_at,
    users.id AS user_id, users.name, users.email, users.image,
    users.email_verified
FROM members
JOIN users ON users.id = members.user_id
WHERE members.organization_id = $1 AND users.deleted_at IS NULL
ORDER BY
    CASE members.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
    users.name;

-- name: CountOrganizationOwners :one
SELECT count(*)::int
FROM members
WHERE organization_id = $1 AND role = 'owner';

-- name: ListOrganizationInvitations :many
SELECT
    invitations.id, invitations.email, invitations.role, invitations.status,
    invitations.expires_at, invitations.created_at, invitations.invited_user_id,
    invitations.team_id, teams.name AS team_name
FROM invitations
LEFT JOIN teams ON teams.id = invitations.team_id
WHERE invitations.organization_id = $1
ORDER BY invitations.created_at DESC;

-- name: UpdateOrganizationMemberRole :one
UPDATE members SET role = $3
WHERE organization_id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteOrganizationMember :one
DELETE FROM members
WHERE organization_id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteOrganizationMemberTeams :exec
DELETE FROM team_members
USING teams
WHERE team_members.team_id = teams.id
  AND teams.organization_id = $1
  AND team_members.user_id = $2;

-- name: ClearOrganizationFromUserSessions :exec
UPDATE sessions
SET active_organization_id = NULL, active_team_id = NULL
WHERE user_id = $1 AND active_organization_id = $2;

-- name: CreateOrganizationTeam :one
INSERT INTO teams (
    id, name, description, organization_id, lead_user_id, created_at, updated_at
) VALUES (
    $1, $2, $3, $4, $5, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
)
RETURNING *;

-- name: ListOrganizationTeams :many
SELECT
    teams.id, teams.name, teams.description, teams.lead_user_id,
    teams.created_at, teams.updated_at, teams.archived_at,
    lead.name AS lead_name, count(team_members.id)::int AS member_count
FROM teams
LEFT JOIN users AS lead ON lead.id = teams.lead_user_id
LEFT JOIN team_members ON team_members.team_id = teams.id
WHERE teams.organization_id = $1
  AND (sqlc.arg(include_archived)::boolean OR teams.archived_at IS NULL)
GROUP BY teams.id, lead.id
ORDER BY teams.archived_at NULLS FIRST, teams.name;

-- name: GetOrganizationTeam :one
SELECT * FROM teams
WHERE id = $1 AND organization_id = $2;

-- name: CountActiveOrganizationMembersByIDs :one
SELECT count(*)::int
FROM members
JOIN users ON users.id = members.user_id
WHERE members.organization_id = sqlc.arg(organization_id)::text
  AND members.user_id = ANY(sqlc.arg(user_ids)::text[])
  AND users.deleted_at IS NULL
  AND NOT (
      coalesce(users.banned, FALSE)
      AND (users.ban_expires IS NULL OR users.ban_expires > (now() AT TIME ZONE 'UTC'))
  );

-- name: UpdateOrganizationTeam :one
UPDATE teams SET name = $3, description = $4, lead_user_id = $5
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: SetOrganizationTeamArchived :one
UPDATE teams
SET archived_at = CASE
    WHEN sqlc.arg(archived)::boolean THEN (now() AT TIME ZONE 'UTC')
    ELSE NULL
END
WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: DeleteOrganizationTeam :one
DELETE FROM teams WHERE id = $1 AND organization_id = $2
RETURNING *;

-- name: ListOrganizationTeamMembers :many
SELECT
    team_members.id, users.id AS user_id, users.name, users.email,
    users.image, members.role AS organization_role, team_members.created_at
FROM team_members
JOIN users ON users.id = team_members.user_id
JOIN members
  ON members.user_id = users.id
 AND members.organization_id = sqlc.arg(organization_id)::text
WHERE team_members.team_id = sqlc.arg(team_id)::text
ORDER BY users.name;

-- name: AddOrganizationTeamMember :execrows
INSERT INTO team_members (id, team_id, user_id, created_at)
SELECT
    sqlc.arg(id)::text, sqlc.arg(team_id)::text, sqlc.arg(user_id)::text,
    (now() AT TIME ZONE 'UTC')
WHERE EXISTS (
    SELECT 1 FROM teams
    JOIN members ON members.organization_id = teams.organization_id
    WHERE teams.id = sqlc.arg(team_id)::text
      AND teams.organization_id = sqlc.arg(organization_id)::text
      AND members.user_id = sqlc.arg(user_id)::text
)
ON CONFLICT (team_id, user_id) DO NOTHING;

-- name: DeleteOrganizationTeamMember :execrows
DELETE FROM team_members USING teams
WHERE team_members.team_id = teams.id
  AND teams.id = sqlc.arg(team_id)::text
  AND teams.organization_id = sqlc.arg(organization_id)::text
  AND team_members.user_id = sqlc.arg(user_id)::text;

-- name: BulkAddOrganizationTeamMembers :execrows
INSERT INTO team_members (id, team_id, user_id, created_at)
SELECT
    sqlc.arg(id_prefix)::text || '-' || row_number() OVER (ORDER BY members.user_id),
    sqlc.arg(team_id)::text,
    members.user_id,
    (now() AT TIME ZONE 'UTC')
FROM members
JOIN users ON users.id = members.user_id
JOIN teams
  ON teams.id = sqlc.arg(team_id)::text
 AND teams.organization_id = members.organization_id
WHERE members.organization_id = sqlc.arg(organization_id)::text
  AND members.user_id = ANY(sqlc.arg(user_ids)::text[])
  AND teams.archived_at IS NULL
  AND users.deleted_at IS NULL
  AND NOT (
      coalesce(users.banned, FALSE)
      AND (users.ban_expires IS NULL OR users.ban_expires > (now() AT TIME ZONE 'UTC'))
  )
ON CONFLICT (team_id, user_id) DO NOTHING;

-- name: BulkDeleteOrganizationTeamMembers :execrows
DELETE FROM team_members USING teams
WHERE team_members.team_id = teams.id
  AND teams.id = sqlc.arg(team_id)::text
  AND teams.organization_id = sqlc.arg(organization_id)::text
  AND teams.archived_at IS NULL
  AND team_members.user_id = ANY(sqlc.arg(user_ids)::text[]);

-- name: TransferOrganizationOwnership :exec
UPDATE members
SET role = CASE
    WHEN user_id = sqlc.arg(new_owner_id)::text THEN 'owner'
    WHEN role = 'owner' THEN 'admin'
    ELSE role
END
WHERE organization_id = sqlc.arg(organization_id)::text
  AND (role = 'owner' OR user_id = sqlc.arg(new_owner_id)::text);

-- name: CreateOrganizationAuditEvent :exec
INSERT INTO auth_events (
    id, user_id, event_type, ip_address, user_agent, target_type,
    target_id, reason, before_state, after_state, organization_id, created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
    (now() AT TIME ZONE 'UTC')
);

-- name: ListOrganizationAuditEvents :many
SELECT
    auth_events.id, auth_events.event_type, auth_events.target_type,
    auth_events.target_id, auth_events.reason, auth_events.before_state,
    auth_events.after_state, auth_events.ip_address, auth_events.user_agent,
    auth_events.created_at, users.id AS actor_id, users.name AS actor_name,
    users.email AS actor_email
FROM auth_events
LEFT JOIN users ON users.id = auth_events.user_id
WHERE auth_events.organization_id = $1
ORDER BY auth_events.created_at DESC
LIMIT $2 OFFSET $3;

-- name: CountOrganizationAuditEvents :one
SELECT count(*) FROM auth_events WHERE organization_id = $1;

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
