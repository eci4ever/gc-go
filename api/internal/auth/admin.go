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
	CreatedAt         time.Time  `json:"createdAt"`
	ActiveSessions    int32      `json:"activeSessions"`
	OrganizationCount int32      `json:"organizationCount"`
}

type adminOrganizationResponse struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	Logo        *string   `json:"logo"`
	Metadata    *string   `json:"metadata"`
	CreatedAt   time.Time `json:"createdAt"`
	OwnerID     *string   `json:"ownerId"`
	OwnerName   *string   `json:"ownerName"`
	OwnerEmail  *string   `json:"ownerEmail"`
	MemberCount int32     `json:"memberCount"`
}

func (h *Handler) RegisterAdmin(router fiber.Router) {
	router.Get("/users", h.adminListUsers)
	router.Post("/users", h.adminCreateUser)
	router.Put("/users/:id", h.adminUpdateUser)
	router.Delete("/users/:id", h.adminDeleteUser)
	router.Post("/users/:id/ban", h.adminSetUserBan)
	router.Post("/users/:id/impersonate", h.adminImpersonateUser)

	router.Get("/organizations", h.adminListOrganizations)
	router.Post("/organizations", h.adminCreateOrganization)
	router.Put("/organizations/:id", h.adminUpdateOrganization)
	router.Delete("/organizations/:id", h.adminDeleteOrganization)
}

func (h *Handler) adminListUsers(c fiber.Ctx) error {
	if _, ok := h.requirePlatformAdmin(c); !ok {
		return nil
	}
	users, err := h.queries.AdminListUsers(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load users")
	}
	response := make([]adminUserResponse, 0, len(users))
	for _, user := range users {
		response = append(response, adminUserFromRow(user))
	}
	return c.JSON(fiber.Map{"users": response})
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

	h.recordAuthEvent(c, admin.UserID, "admin_user_created")
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
	h.recordAuthEvent(c, admin.UserID, "admin_user_updated")
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

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update user ban")
	}
	defer transaction.Rollback(c.Context())
	queries := h.queries.WithTx(transaction)
	user, err := queries.AdminSetUserBan(c.Context(), db.AdminSetUserBanParams{
		ID:         targetID,
		Banned:     pgtype.Bool{Bool: request.Banned, Valid: true},
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
	h.recordAuthEvent(c, admin.UserID, "admin_user_ban_updated")
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
	affected, err := h.queries.AdminDeleteUser(c.Context(), targetID)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to delete user")
	}
	if affected == 0 {
		return jsonError(c, fiber.StatusNotFound, "User not found")
	}
	h.recordAuthEvent(c, admin.UserID, "admin_user_deleted")
	return c.SendStatus(fiber.StatusNoContent)
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

	rawToken, tokenHash, err := newSessionToken()
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to impersonate user")
	}
	sessionID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to impersonate user")
	}
	expiresAt := time.Now().UTC().Add(sessionLifetime)
	session, err := h.queries.CreateImpersonatedSession(
		c.Context(),
		db.CreateImpersonatedSessionParams{
			ID:             sessionID,
			ExpiresAt:      timestampValue(expiresAt),
			Token:          tokenHash,
			IpAddress:      textValue(c.IP()),
			UserAgent:      textValue(c.Get("User-Agent")),
			UserID:         target.ID,
			ImpersonatedBy: textValue(admin.UserID),
		},
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to impersonate user")
	}
	h.recordAuthEvent(c, admin.UserID, "admin_impersonation_started")
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
	h.recordAuthEvent(c, admin.ID, "admin_impersonation_stopped")
	return c.JSON(fiber.Map{
		"session": sessionFromModel(session),
		"user":    userFromModel(admin),
	})
}

func (h *Handler) adminListOrganizations(c fiber.Ctx) error {
	if _, ok := h.requirePlatformAdmin(c); !ok {
		return nil
	}
	organizations, err := h.queries.AdminListOrganizations(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load organizations")
	}
	response := make([]adminOrganizationResponse, 0, len(organizations))
	for _, organization := range organizations {
		response = append(response, adminOrganizationFromRow(organization))
	}
	return c.JSON(fiber.Map{"organizations": response})
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
	if err != nil || activeBan(owner.Banned, owner.BanExpires) {
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
	h.recordAuthEvent(c, admin.UserID, "admin_organization_created")
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
	if err != nil || activeBan(owner.Banned, owner.BanExpires) {
		return jsonError(c, fiber.StatusBadRequest, "Select an active organization owner")
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
	h.recordAuthEvent(c, admin.UserID, "admin_organization_updated")
	return c.JSON(fiber.Map{"organization": organization})
}

func (h *Handler) adminDeleteOrganization(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	affected, err := h.queries.AdminDeleteOrganization(c.Context(), c.Params("id"))
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to delete organization")
	}
	if affected == 0 {
		return jsonError(c, fiber.StatusNotFound, "Organization not found")
	}
	h.recordAuthEvent(c, admin.UserID, "admin_organization_deleted")
	return c.SendStatus(fiber.StatusNoContent)
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
