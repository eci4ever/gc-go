package auth

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"

	"gc-go/api/internal/db"
)

var organizationSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

type adminUserRequest struct {
	Name          string `json:"name"`
	Email         string `json:"email"`
	Image         string `json:"image"`
	Password      string `json:"password"`
	Role          string `json:"role"`
	EmailVerified bool   `json:"emailVerified"`
}

type adminBanRequest struct {
	Banned    bool   `json:"banned"`
	Reason    string `json:"reason"`
	ExpiresAt string `json:"expiresAt"`
}

type adminImpersonationRequest struct {
	Reason          string `json:"reason"`
	DurationMinutes int    `json:"durationMinutes"`
}

type adminOrganizationRequest struct {
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	Logo     string `json:"logo"`
	Metadata string `json:"metadata"`
	OwnerID  string `json:"ownerId"`
}

type adminUserResponse struct {
	ID                string     `json:"id"`
	Name              string     `json:"name"`
	Email             string     `json:"email"`
	EmailVerified     bool       `json:"emailVerified"`
	Image             *string    `json:"image"`
	Role              string     `json:"role"`
	Banned            bool       `json:"banned"`
	BanReason         *string    `json:"banReason"`
	BanExpires        *time.Time `json:"banExpires"`
	DeletedAt         *time.Time `json:"deletedAt"`
	CreatedAt         time.Time  `json:"createdAt"`
	ActiveSessions    int32      `json:"activeSessions"`
	OrganizationCount int32      `json:"organizationCount"`
}

type adminOrganizationResponse struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Slug        string     `json:"slug"`
	Logo        *string    `json:"logo"`
	Metadata    *string    `json:"metadata"`
	DeletedAt   *time.Time `json:"deletedAt"`
	CreatedAt   time.Time  `json:"createdAt"`
	OwnerID     *string    `json:"ownerId"`
	OwnerName   *string    `json:"ownerName"`
	OwnerEmail  *string    `json:"ownerEmail"`
	MemberCount int32      `json:"memberCount"`
}

func (h *Handler) RegisterAdmin(router fiber.Router) {
	router.Get("/users", h.adminListUsers)
	router.Post("/users", h.adminCreateUser)
	router.Put("/users/:id", h.adminUpdateUser)
	router.Delete("/users/:id", h.adminDeleteUser)
	router.Post("/users/:id/restore", h.adminRestoreUser)
	router.Post("/users/bulk", h.adminBulkUsers)
	router.Post("/users/:id/ban", h.adminSetUserBan)
	router.Post("/users/:id/impersonate", h.adminImpersonateUser)

	router.Get("/organizations", h.adminListOrganizations)
	router.Post("/organizations", h.adminCreateOrganization)
	router.Put("/organizations/:id", h.adminUpdateOrganization)
	router.Delete("/organizations/:id", h.adminDeleteOrganization)
	router.Post("/organizations/:id/restore", h.adminRestoreOrganization)
	router.Get("/organizations/:id/members", h.adminListOrganizationMembers)
	router.Post("/organizations/:id/members", h.adminAddOrganizationMember)
	router.Put("/organizations/:id/members/:userId", h.adminUpdateOrganizationMember)
	router.Delete("/organizations/:id/members/:userId", h.adminDeleteOrganizationMember)
	router.Post("/organizations/:id/invitations", h.adminInviteOrganizationMember)
	router.Delete("/organizations/:id/invitations/:invitationId", h.adminCancelOrganizationInvitation)
	router.Get("/audit-events", h.adminListAuditEvents)
	router.Get("/dashboard", h.adminDashboard)
}

func (h *Handler) adminListUsers(c fiber.Ctx) error {
	if _, ok := h.requirePlatformAdmin(c); !ok {
		return nil
	}
	page, pageSize := adminPagination(c)
	filter := db.AdminListUsersParams{
		IncludeDeleted: c.Query("includeDeleted") == "true",
		Search:         strings.TrimSpace(c.Query("search")),
		Role:           strings.TrimSpace(c.Query("role")),
		Status:         strings.TrimSpace(c.Query("status")),
		PageOffset:     int32((page - 1) * pageSize),
		PageSize:       int32(pageSize),
	}
	users, err := h.queries.AdminListUsers(c.Context(), filter)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load users")
	}
	response := make([]adminUserResponse, 0, len(users))
	for _, user := range users {
		response = append(response, adminUserFromRow(user))
	}
	count, err := h.queries.AdminCountUsers(c.Context(), db.AdminCountUsersParams{
		IncludeDeleted: filter.IncludeDeleted,
		Search:         filter.Search,
		Role:           filter.Role,
		Status:         filter.Status,
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load users")
	}
	return c.JSON(fiber.Map{
		"users": response,
		"pagination": fiber.Map{
			"page": page, "pageSize": pageSize, "total": count,
		},
	})
}

func (h *Handler) adminCreateUser(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	var request adminUserRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if message := validateAdminUserRequest(&request, true); message != "" {
		return jsonError(c, fiber.StatusBadRequest, message)
	}

	passwordHash, err := bcrypt.GenerateFromPassword(
		[]byte(request.Password),
		bcrypt.DefaultCost,
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create user")
	}
	userID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create user")
	}
	accountID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create user")
	}

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create user")
	}
	defer transaction.Rollback(c.Context())
	queries := h.queries.WithTx(transaction)
	user, err := queries.AdminCreateUser(c.Context(), db.AdminCreateUserParams{
		ID:            userID,
		Name:          request.Name,
		Email:         request.Email,
		EmailVerified: request.EmailVerified,
		Image:         textValue(request.Image),
		Role:          request.Role,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return jsonError(c, fiber.StatusConflict, "An account with this email already exists")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create user")
	}
	if err := queries.CreateCredentialAccount(
		c.Context(),
		db.CreateCredentialAccountParams{
			ID:        accountID,
			AccountID: userID,
			UserID:    userID,
			Password:  textValue(string(passwordHash)),
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create user")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create user")
	}

	h.recordAdminAudit(c, admin.UserID, "admin_user_created", "user", user.ID, "", nil, user)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"user": userFromModel(user)})
}

func (h *Handler) adminUpdateUser(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	targetID := c.Params("id")
	var request adminUserRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if message := validateAdminUserRequest(&request, false); message != "" {
		return jsonError(c, fiber.StatusBadRequest, message)
	}
	if targetID == admin.UserID && request.Role != "admin" {
		return jsonError(c, fiber.StatusBadRequest, "You cannot remove your own admin role")
	}
	if err := h.protectLastAdmin(c, targetID, request.Role == "admin"); err != nil {
		return err
	}
	before, err := h.queries.AdminGetUser(c.Context(), targetID)
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "User not found")
	}

	user, err := h.queries.AdminUpdateUser(c.Context(), db.AdminUpdateUserParams{
		ID:            targetID,
		Name:          request.Name,
		Email:         request.Email,
		EmailVerified: request.EmailVerified,
		Image:         textValue(request.Image),
		Role:          request.Role,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusNotFound, "User not found")
		}
		if isUniqueViolation(err) {
			return jsonError(c, fiber.StatusConflict, "An account with this email already exists")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update user")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_user_updated", "user", targetID, "", before, user)
	return c.JSON(fiber.Map{"user": userFromModel(user)})
}

func (h *Handler) adminSetUserBan(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	targetID := c.Params("id")
	if targetID == admin.UserID {
		return jsonError(c, fiber.StatusBadRequest, "You cannot ban your own account")
	}
	var request adminBanRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	request.Reason = strings.TrimSpace(request.Reason)
	if request.Banned && request.Reason == "" {
		return jsonError(c, fiber.StatusBadRequest, "A ban reason is required")
	}
	var expiresAt pgtype.Timestamp
	if request.Banned && request.ExpiresAt != "" {
		parsed, err := time.Parse(time.RFC3339, request.ExpiresAt)
		if err != nil || !parsed.After(time.Now()) {
			return jsonError(c, fiber.StatusBadRequest, "Ban expiry must be a future date")
		}
		expiresAt = timestampValue(parsed.UTC())
	}
	before, err := h.queries.AdminGetUser(c.Context(), targetID)
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "User not found")
	}

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update user ban")
	}
	defer transaction.Rollback(c.Context())
	queries := h.queries.WithTx(transaction)
	user, err := queries.AdminSetUserBan(c.Context(), db.AdminSetUserBanParams{
		ID:         targetID,
		Banned:     request.Banned,
		BanReason:  textValue(request.Reason),
		BanExpires: expiresAt,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusNotFound, "User not found")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update user ban")
	}
	if request.Banned {
		if err := queries.DeleteAllUserSessions(c.Context(), targetID); err != nil {
			return jsonError(c, fiber.StatusInternalServerError, "Unable to update user ban")
		}
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update user ban")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_user_ban_updated", "user", targetID, request.Reason, before, user)
	return c.JSON(fiber.Map{"user": userFromModel(user)})
}

func (h *Handler) adminDeleteUser(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	targetID := c.Params("id")
	if targetID == admin.UserID {
		return jsonError(c, fiber.StatusBadRequest, "You cannot delete your own account")
	}
	if err := h.protectLastAdmin(c, targetID, false); err != nil {
		return err
	}
	ownedOrganizations, err := h.queries.AdminCountOwnedOrganizations(
		c.Context(),
		targetID,
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to delete user")
	}
	if ownedOrganizations > 0 {
		return jsonError(
			c,
			fiber.StatusBadRequest,
			"Transfer organization ownership before deleting this user",
		)
	}
	before, err := h.queries.AdminGetUser(c.Context(), targetID)
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "User not found")
	}
	user, err := h.queries.AdminSoftDeleteUser(c.Context(), targetID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusNotFound, "User not found")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to delete user")
	}
	if err := h.queries.DeleteAllUserSessions(c.Context(), targetID); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to delete user")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_user_deleted", "user", targetID, "", before, user)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) adminRestoreUser(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	targetID := c.Params("id")
	before, _ := h.queries.AdminGetUser(c.Context(), targetID)
	user, err := h.queries.AdminRestoreUser(c.Context(), targetID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusNotFound, "Deleted user not found")
		}
		if isUniqueViolation(err) {
			return jsonError(c, fiber.StatusConflict, "Email is already used by an active account")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to restore user")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_user_restored", "user", targetID, "", before, user)
	return c.JSON(fiber.Map{"user": userFromModel(user)})
}

func (h *Handler) adminImpersonateUser(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	targetID := c.Params("id")
	if targetID == admin.UserID {
		return jsonError(c, fiber.StatusBadRequest, "You are already using this account")
	}
	var request adminImpersonationRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	request.Reason = strings.TrimSpace(request.Reason)
	if request.Reason == "" {
		return jsonError(c, fiber.StatusBadRequest, "An impersonation reason is required")
	}
	if request.DurationMinutes < 1 || request.DurationMinutes > 60 {
		return jsonError(c, fiber.StatusBadRequest, "Impersonation duration must be between 1 and 60 minutes")
	}
	target, err := h.queries.AdminGetUser(c.Context(), targetID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusNotFound, "User not found")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to impersonate user")
	}
	if activeBan(target.Banned, target.BanExpires) {
		return jsonError(c, fiber.StatusBadRequest, "Banned users cannot be impersonated")
	}
	if target.DeletedAt.Valid {
		return jsonError(c, fiber.StatusBadRequest, "Deleted users cannot be impersonated")
	}

	rawToken, tokenHash, err := newSessionToken()
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to impersonate user")
	}
	sessionID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to impersonate user")
	}
	expiresAt := time.Now().UTC().Add(
		time.Duration(request.DurationMinutes) * time.Minute,
	)
	session, err := h.queries.CreateImpersonatedSession(
		c.Context(),
		db.CreateImpersonatedSessionParams{
			ID:                  sessionID,
			ExpiresAt:           timestampValue(expiresAt),
			Token:               tokenHash,
			IpAddress:           textValue(c.IP()),
			UserAgent:           textValue(c.Get("User-Agent")),
			UserID:              target.ID,
			ImpersonatedBy:      textValue(admin.UserID),
			ImpersonationReason: textValue(request.Reason),
		},
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to impersonate user")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_impersonation_started", "user", target.ID, request.Reason, nil, fiber.Map{
		"expiresAt": expiresAt,
	})
	h.setSessionCookie(c, rawToken, expiresAt)
	return c.JSON(fiber.Map{
		"session": sessionFromModel(session),
		"user":    userFromModel(target),
	})
}

func (h *Handler) stopImpersonation(c fiber.Ctx) error {
	current, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to stop impersonation")
	}
	if !ok {
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}
	if !current.ImpersonatedBy.Valid {
		return jsonError(c, fiber.StatusBadRequest, "This session is not impersonating a user")
	}
	admin, err := h.queries.AdminGetUser(c.Context(), current.ImpersonatedBy.String)
	if err != nil || admin.Role != "admin" ||
		activeBan(admin.Banned, admin.BanExpires) {
		return jsonError(c, fiber.StatusForbidden, "Admin account is unavailable")
	}

	rawToken, tokenHash, err := newSessionToken()
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to stop impersonation")
	}
	sessionID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to stop impersonation")
	}
	expiresAt := time.Now().UTC().Add(sessionLifetime)
	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to stop impersonation")
	}
	defer transaction.Rollback(c.Context())
	queries := h.queries.WithTx(transaction)
	session, err := queries.CreateSession(c.Context(), sessionParams(
		sessionID,
		tokenHash,
		admin.ID,
		expiresAt,
		c,
	))
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to stop impersonation")
	}
	if err := queries.DeleteSession(
		c.Context(),
		hashToken(c.Cookies(sessionCookieName)),
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to stop impersonation")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to stop impersonation")
	}
	h.setSessionCookie(c, rawToken, expiresAt)
	h.recordAdminAudit(
		c,
		admin.ID,
		"admin_impersonation_stopped",
		"user",
		current.UserID,
		current.ImpersonationReason.String,
		fiber.Map{"impersonatedSessionId": current.SessionID},
		nil,
	)
	return c.JSON(fiber.Map{
		"session": sessionFromModel(session),
		"user":    userFromModel(admin),
	})
}

func (h *Handler) adminListOrganizations(c fiber.Ctx) error {
	if _, ok := h.requirePlatformAdmin(c); !ok {
		return nil
	}
	page, pageSize := adminPagination(c)
	filter := db.AdminListOrganizationsParams{
		IncludeDeleted: c.Query("includeDeleted") == "true",
		Search:         strings.TrimSpace(c.Query("search")),
		PageOffset:     int32((page - 1) * pageSize),
		PageSize:       int32(pageSize),
	}
	organizations, err := h.queries.AdminListOrganizations(c.Context(), filter)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load organizations")
	}
	response := make([]adminOrganizationResponse, 0, len(organizations))
	for _, organization := range organizations {
		response = append(response, adminOrganizationFromRow(organization))
	}
	count, err := h.queries.AdminCountOrganizations(
		c.Context(),
		db.AdminCountOrganizationsParams{
			IncludeDeleted: filter.IncludeDeleted,
			Search:         filter.Search,
		},
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load organizations")
	}
	return c.JSON(fiber.Map{
		"organizations": response,
		"pagination": fiber.Map{
			"page": page, "pageSize": pageSize, "total": count,
		},
	})
}

func (h *Handler) adminCreateOrganization(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	var request adminOrganizationRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if message := validateAdminOrganizationRequest(&request); message != "" {
		return jsonError(c, fiber.StatusBadRequest, message)
	}
	owner, err := h.queries.AdminGetUser(c.Context(), request.OwnerID)
	if err != nil || owner.DeletedAt.Valid ||
		activeBan(owner.Banned, owner.BanExpires) {
		return jsonError(c, fiber.StatusBadRequest, "Select an active organization owner")
	}
	organizationID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create organization")
	}
	memberID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create organization")
	}

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create organization")
	}
	defer transaction.Rollback(c.Context())
	queries := h.queries.WithTx(transaction)
	organization, err := queries.AdminCreateOrganization(
		c.Context(),
		db.AdminCreateOrganizationParams{
			ID:       organizationID,
			Name:     request.Name,
			Slug:     request.Slug,
			Logo:     textValue(request.Logo),
			Metadata: textValue(request.Metadata),
		},
	)
	if err != nil {
		if isUniqueViolation(err) {
			return jsonError(c, fiber.StatusConflict, "Organization slug is already in use")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create organization")
	}
	if err := queries.AdminUpsertOrganizationOwner(
		c.Context(),
		db.AdminUpsertOrganizationOwnerParams{
			ID:             memberID,
			OrganizationID: organizationID,
			UserID:         request.OwnerID,
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create organization")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create organization")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_organization_created", "organization", organization.ID, "", nil, organization)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"organization": organization})
}

func (h *Handler) adminUpdateOrganization(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	organizationID := c.Params("id")
	var request adminOrganizationRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if message := validateAdminOrganizationRequest(&request); message != "" {
		return jsonError(c, fiber.StatusBadRequest, message)
	}
	owner, err := h.queries.AdminGetUser(c.Context(), request.OwnerID)
	if err != nil || owner.DeletedAt.Valid ||
		activeBan(owner.Banned, owner.BanExpires) {
		return jsonError(c, fiber.StatusBadRequest, "Select an active organization owner")
	}
	before, err := h.queries.AdminGetOrganization(c.Context(), organizationID)
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "Organization not found")
	}
	memberID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update organization")
	}

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update organization")
	}
	defer transaction.Rollback(c.Context())
	queries := h.queries.WithTx(transaction)
	organization, err := queries.AdminUpdateOrganization(
		c.Context(),
		db.AdminUpdateOrganizationParams{
			ID:       organizationID,
			Name:     request.Name,
			Slug:     request.Slug,
			Logo:     textValue(request.Logo),
			Metadata: textValue(request.Metadata),
		},
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusNotFound, "Organization not found")
		}
		if isUniqueViolation(err) {
			return jsonError(c, fiber.StatusConflict, "Organization slug is already in use")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update organization")
	}
	if err := queries.AdminDemoteOrganizationOwners(c.Context(), organizationID); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update organization")
	}
	if err := queries.AdminUpsertOrganizationOwner(
		c.Context(),
		db.AdminUpsertOrganizationOwnerParams{
			ID:             memberID,
			OrganizationID: organizationID,
			UserID:         request.OwnerID,
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update organization")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update organization")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_organization_updated", "organization", organizationID, "", before, organization)
	return c.JSON(fiber.Map{"organization": organization})
}

func (h *Handler) adminDeleteOrganization(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	organizationID := c.Params("id")
	before, err := h.queries.AdminGetOrganization(c.Context(), organizationID)
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "Organization not found")
	}
	organization, err := h.queries.AdminSoftDeleteOrganization(
		c.Context(),
		organizationID,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusNotFound, "Organization not found")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to delete organization")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_organization_deleted", "organization", organizationID, "", before, organization)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) adminRestoreOrganization(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	organizationID := c.Params("id")
	before, _ := h.queries.AdminGetOrganization(c.Context(), organizationID)
	organization, err := h.queries.AdminRestoreOrganization(
		c.Context(),
		organizationID,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusNotFound, "Deleted organization not found")
		}
		if isUniqueViolation(err) {
			return jsonError(c, fiber.StatusConflict, "Slug is already used by an active organization")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to restore organization")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_organization_restored", "organization", organizationID, "", before, organization)
	return c.JSON(fiber.Map{"organization": organization})
}

func (h *Handler) requirePlatformAdmin(c fiber.Ctx) (db.GetSessionUserRow, bool) {
	current, ok, err := h.currentSession(c)
	if err != nil {
		_ = jsonError(c, fiber.StatusInternalServerError, "Unable to authorize request")
		return db.GetSessionUserRow{}, false
	}
	if !ok {
		h.clearSessionCookie(c)
		_ = jsonError(c, fiber.StatusUnauthorized, "Authentication required")
		return db.GetSessionUserRow{}, false
	}
	if current.UserRole != "admin" || current.ImpersonatedBy.Valid {
		_ = jsonError(c, fiber.StatusForbidden, "Platform admin access required")
		return db.GetSessionUserRow{}, false
	}
	return current, true
}

func (h *Handler) protectLastAdmin(
	c fiber.Ctx,
	targetID string,
	willRemainAdmin bool,
) error {
	target, err := h.queries.AdminGetUser(c.Context(), targetID)
	if errors.Is(err, pgx.ErrNoRows) {
		return jsonError(c, fiber.StatusNotFound, "User not found")
	}
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update user")
	}
	if target.Role != "admin" || willRemainAdmin {
		return nil
	}
	count, err := h.queries.AdminCountUsersByRole(c.Context(), "admin")
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update user")
	}
	if count <= 1 {
		return jsonError(c, fiber.StatusBadRequest, "The last platform admin must be preserved")
	}
	return nil
}

func validateAdminUserRequest(request *adminUserRequest, requirePassword bool) string {
	request.Name = strings.TrimSpace(request.Name)
	request.Email = strings.ToLower(strings.TrimSpace(request.Email))
	request.Image = strings.TrimSpace(request.Image)
	request.Role = strings.ToLower(strings.TrimSpace(request.Role))
	if request.Name == "" || len(request.Name) > 100 {
		return "Name must be between 1 and 100 characters"
	}
	if !validEmail(request.Email) {
		return "Enter a valid email address"
	}
	if request.Image != "" && !validImageURL(request.Image) {
		return "Image must be a valid HTTP or HTTPS URL"
	}
	if request.Role != "user" && request.Role != "admin" {
		return "Role must be user or admin"
	}
	if requirePassword &&
		(len(request.Password) < 8 || len(request.Password) > 72) {
		return "Password must be between 8 and 72 characters"
	}
	return ""
}

func validateAdminOrganizationRequest(request *adminOrganizationRequest) string {
	request.Name = strings.TrimSpace(request.Name)
	request.Slug = strings.ToLower(strings.TrimSpace(request.Slug))
	request.Logo = strings.TrimSpace(request.Logo)
	request.Metadata = strings.TrimSpace(request.Metadata)
	request.OwnerID = strings.TrimSpace(request.OwnerID)
	if request.Name == "" || len(request.Name) > 100 {
		return "Organization name must be between 1 and 100 characters"
	}
	if !organizationSlugPattern.MatchString(request.Slug) {
		return "Slug may contain lowercase letters, numbers, and hyphens"
	}
	if request.Logo != "" && !validImageURL(request.Logo) {
		return "Logo must be a valid HTTP or HTTPS URL"
	}
	if request.Metadata != "" && !json.Valid([]byte(request.Metadata)) {
		return "Metadata must be valid JSON"
	}
	if request.OwnerID == "" {
		return "Organization owner is required"
	}
	return ""
}

func adminUserFromRow(user db.AdminListUsersRow) adminUserResponse {
	return adminUserResponse{
		ID:                user.ID,
		Name:              user.Name,
		Email:             user.Email,
		EmailVerified:     user.EmailVerified,
		Image:             stringPointer(user.Image),
		Role:              user.Role,
		Banned:            user.Banned,
		BanReason:         stringPointer(user.BanReason),
		BanExpires:        timePointer(user.BanExpires),
		DeletedAt:         timePointer(user.DeletedAt),
		CreatedAt:         user.CreatedAt.Time,
		ActiveSessions:    user.ActiveSessions,
		OrganizationCount: user.OrganizationCount,
	}
}

func adminOrganizationFromRow(
	organization db.AdminListOrganizationsRow,
) adminOrganizationResponse {
	return adminOrganizationResponse{
		ID:          organization.ID,
		Name:        organization.Name,
		Slug:        organization.Slug,
		Logo:        stringPointer(organization.Logo),
		Metadata:    stringPointer(organization.Metadata),
		DeletedAt:   timePointer(organization.DeletedAt),
		CreatedAt:   organization.CreatedAt.Time,
		OwnerID:     stringPointer(organization.OwnerID),
		OwnerName:   stringPointer(organization.OwnerName),
		OwnerEmail:  stringPointer(organization.OwnerEmail),
		MemberCount: organization.MemberCount,
	}
}

func timePointer(value pgtype.Timestamp) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}
