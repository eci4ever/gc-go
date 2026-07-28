package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log"
	"net/mail"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"gc-go/api/internal/db"
)

const (
	sessionCookieName    = "gc_go_session"
	sessionLifetime      = 7 * 24 * time.Hour
	verificationLifetime = 30 * time.Minute
)

type VerificationEmailSender interface {
	SendVerification(
		ctx context.Context,
		to string,
		name string,
		verificationURL string,
	) error
	SendPasswordReset(
		ctx context.Context,
		to string,
		name string,
		resetURL string,
	) error
	SendOrganizationInvitation(
		ctx context.Context,
		to string,
		organizationName string,
		invitationURL string,
	) error
}

type Handler struct {
	pool         *pgxpool.Pool
	queries      *db.Queries
	cookieSecure bool
	emailSender  VerificationEmailSender
	appURL       string
}

type credentialsRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type updateProfileRequest struct {
	Name  string `json:"name"`
	Image string `json:"image"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

type userResponse struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Email         string  `json:"email"`
	EmailVerified bool    `json:"emailVerified"`
	Image         *string `json:"image"`
	Role          string  `json:"role"`
}

type sessionResponse struct {
	ID                   string    `json:"id"`
	ExpiresAt            time.Time `json:"expiresAt"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
	IPAddress            *string   `json:"ipAddress"`
	UserAgent            *string   `json:"userAgent"`
	UserID               string    `json:"userId"`
	ImpersonatedBy       *string   `json:"impersonatedBy"`
	ActiveOrganizationID *string   `json:"activeOrganizationId"`
	ActiveTeamID         *string   `json:"activeTeamId"`
	ImpersonationReason  *string   `json:"impersonationReason"`
}

type managedSessionResponse struct {
	sessionResponse
	Current bool `json:"current"`
}

func NewHandler(
	pool *pgxpool.Pool,
	queries *db.Queries,
	cookieSecure bool,
) *Handler {
	return &Handler{
		pool:         pool,
		queries:      queries,
		cookieSecure: cookieSecure,
	}
}

func (h *Handler) ConfigureEmailVerification(
	sender VerificationEmailSender,
	appURL string,
) {
	h.emailSender = sender
	h.appURL = strings.TrimRight(appURL, "/")
}

func (h *Handler) Register(router fiber.Router) {
	router.Post("/signup", h.signup)
	router.Post("/login", h.login)
	router.Post("/logout", h.logout)
	router.Get("/session", h.session)
	router.Put("/profile", h.updateProfile)
	router.Put("/password", h.changePassword)
	router.Get("/sessions", h.listSessions)
	router.Delete("/sessions", h.revokeOtherSessions)
	router.Delete("/sessions/:id", h.revokeSession)
	router.Get("/2fa/status", h.twoFactorStatus)
	router.Post("/2fa/setup", h.setupTwoFactor)
	router.Post("/2fa/enable", h.enableTwoFactor)
	router.Post("/2fa/disable", h.disableTwoFactor)
	router.Post("/2fa/verify-login", h.verifyTwoFactorLogin)
	router.Post("/email-verification", h.sendEmailVerification)
	router.Post("/email-verification/verify", h.verifyEmail)
	router.Post("/forgot-password", h.forgotPassword)
	router.Post("/reset-password", h.resetPassword)
	router.Post("/impersonation/stop", h.stopImpersonation)
	router.Post("/invitations/accept", h.acceptOrganizationInvitation)
	router.Get("/notifications", h.listNotifications)
	router.Post("/notifications/read-all", h.markAllNotificationsRead)
	router.Post("/notifications/:id/read", h.markNotificationRead)
	router.Delete("/notifications/read", h.deleteReadNotifications)
	router.Delete("/notifications/:id", h.deleteNotification)
}

func (h *Handler) signup(c fiber.Ctx) error {
	var request credentialsRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}

	request.Name = strings.TrimSpace(request.Name)
	request.Email = strings.ToLower(strings.TrimSpace(request.Email))
	if request.Name == "" || len(request.Name) > 100 {
		return jsonError(c, fiber.StatusBadRequest, "Name is required")
	}
	if !validEmail(request.Email) {
		return jsonError(c, fiber.StatusBadRequest, "Enter a valid email address")
	}
	if len(request.Password) < 8 || len(request.Password) > 72 {
		return jsonError(
			c,
			fiber.StatusBadRequest,
			"Password must be between 8 and 72 characters",
		)
	}

	passwordHash, err := bcrypt.GenerateFromPassword(
		[]byte(request.Password),
		bcrypt.DefaultCost,
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
	}

	userID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
	}
	accountID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
	}
	rawToken, tokenHash, err := newSessionToken()
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
	}
	sessionID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
	}
	expiresAt := time.Now().UTC().Add(sessionLifetime)

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
	}
	defer transaction.Rollback(c.Context())

	queries := h.queries.WithTx(transaction)
	user, err := queries.CreateUser(c.Context(), db.CreateUserParams{
		ID:    userID,
		Name:  request.Name,
		Email: request.Email,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return jsonError(c, fiber.StatusConflict, "An account with this email already exists")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
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
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
	}
	session, err := queries.CreateSession(c.Context(), sessionParams(
		sessionID,
		tokenHash,
		userID,
		expiresAt,
		c,
	))
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
	}

	h.setSessionCookie(c, rawToken, expiresAt)
	h.recordAuthEvent(c, userID, "account_created")
	if err := h.createAndSendEmailVerification(c.Context(), user); err != nil {
		log.Printf("send signup verification email: %v", err)
	}
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"session": sessionFromModel(session),
		"user":    userFromModel(user),
	})
}

func (h *Handler) login(c fiber.Ctx) error {
	var request credentialsRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	request.Email = strings.ToLower(strings.TrimSpace(request.Email))
	if !validEmail(request.Email) || request.Password == "" {
		return jsonError(c, fiber.StatusUnauthorized, "Invalid email or password")
	}

	user, err := h.queries.GetCredentialUserByEmail(c.Context(), request.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusUnauthorized, "Invalid email or password")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
	}
	if !user.Password.Valid ||
		bcrypt.CompareHashAndPassword(
			[]byte(user.Password.String),
			[]byte(request.Password),
		) != nil {
		return jsonError(c, fiber.StatusUnauthorized, "Invalid email or password")
	}
	if activeBan(user.Banned, user.BanExpires) {
		return jsonError(c, fiber.StatusForbidden, "This account is unavailable")
	}
	if user.TwoFactorEnabled {
		challengeToken, challengeHash, err := newSessionToken()
		if err != nil {
			return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
		}
		challengeID, err := randomValue(18)
		if err != nil {
			return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
		}
		if err := h.queries.CreateTwoFactorChallenge(
			c.Context(),
			db.CreateTwoFactorChallengeParams{
				ID:        challengeID,
				Token:     challengeHash,
				UserID:    user.ID,
				ExpiresAt: timestampValue(time.Now().UTC().Add(5 * time.Minute)),
			},
		); err != nil {
			return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
		}
		return c.JSON(fiber.Map{
			"twoFactorRequired": true,
			"challengeToken":    challengeToken,
		})
	}

	rawToken, tokenHash, err := newSessionToken()
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
	}
	sessionID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
	}
	expiresAt := time.Now().UTC().Add(sessionLifetime)
	session, err := h.queries.CreateSession(c.Context(), sessionParams(
		sessionID,
		tokenHash,
		user.ID,
		expiresAt,
		c,
	))
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
	}

	h.setSessionCookie(c, rawToken, expiresAt)
	h.recordAuthEvent(c, user.ID, "login_success")
	return c.JSON(fiber.Map{
		"session": sessionFromModel(session),
		"user":    userFromCredentialRow(user),
	})
}

func (h *Handler) session(c fiber.Ctx) error {
	rawToken := c.Cookies(sessionCookieName)
	if rawToken == "" {
		return c.JSON(fiber.Map{"session": nil, "user": nil})
	}

	user, err := h.queries.GetSessionUser(c.Context(), hashToken(rawToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			h.clearSessionCookie(c)
			return c.JSON(fiber.Map{"session": nil, "user": nil})
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to read session")
	}

	return c.JSON(fiber.Map{
		"session": sessionFromRow(user),
		"user":    userFromSessionRow(user),
	})
}

func (h *Handler) logout(c fiber.Ctx) error {
	rawToken := c.Cookies(sessionCookieName)
	if rawToken != "" {
		if err := h.queries.DeleteSession(c.Context(), hashToken(rawToken)); err != nil {
			return jsonError(c, fiber.StatusInternalServerError, "Unable to log out")
		}
	}
	h.clearSessionCookie(c)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) updateProfile(c fiber.Ctx) error {
	session, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to read session")
	}
	if !ok {
		h.clearSessionCookie(c)
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}

	var request updateProfileRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	request.Name = strings.TrimSpace(request.Name)
	request.Image = strings.TrimSpace(request.Image)
	if request.Name == "" || len(request.Name) > 100 {
		return jsonError(c, fiber.StatusBadRequest, "Name must be between 1 and 100 characters")
	}
	if request.Image != "" && !validImageURL(request.Image) {
		return jsonError(c, fiber.StatusBadRequest, "Image must be a valid HTTP or HTTPS URL")
	}

	user, err := h.queries.UpdateUserProfile(c.Context(), db.UpdateUserProfileParams{
		ID:    session.UserID,
		Name:  request.Name,
		Image: textValue(request.Image),
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update profile")
	}

	return c.JSON(fiber.Map{
		"session": sessionFromRow(session),
		"user":    userFromModel(user),
	})
}

func (h *Handler) changePassword(c fiber.Ctx) error {
	session, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to read session")
	}
	if !ok {
		h.clearSessionCookie(c)
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}

	var request changePasswordRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if request.CurrentPassword == "" {
		return jsonError(c, fiber.StatusBadRequest, "Current password is required")
	}
	if len(request.NewPassword) < 8 || len(request.NewPassword) > 72 {
		return jsonError(
			c,
			fiber.StatusBadRequest,
			"New password must be between 8 and 72 characters",
		)
	}

	password, err := h.queries.GetCredentialPasswordByUserID(
		c.Context(),
		session.UserID,
	)
	if err != nil || !password.Valid {
		if errors.Is(err, pgx.ErrNoRows) || !password.Valid {
			return jsonError(c, fiber.StatusBadRequest, "Password login is unavailable")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to change password")
	}
	if bcrypt.CompareHashAndPassword(
		[]byte(password.String),
		[]byte(request.CurrentPassword),
	) != nil {
		return jsonError(c, fiber.StatusBadRequest, "Current password is incorrect")
	}
	if bcrypt.CompareHashAndPassword(
		[]byte(password.String),
		[]byte(request.NewPassword),
	) == nil {
		return jsonError(c, fiber.StatusBadRequest, "New password must be different")
	}

	passwordHash, err := bcrypt.GenerateFromPassword(
		[]byte(request.NewPassword),
		bcrypt.DefaultCost,
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to change password")
	}

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to change password")
	}
	defer transaction.Rollback(c.Context())

	queries := h.queries.WithTx(transaction)
	if err := queries.UpdateCredentialPassword(
		c.Context(),
		db.UpdateCredentialPasswordParams{
			UserID:   session.UserID,
			Password: textValue(string(passwordHash)),
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to change password")
	}
	if err := queries.DeleteOtherUserSessions(
		c.Context(),
		db.DeleteOtherUserSessionsParams{
			UserID: session.UserID,
			Token:  hashToken(c.Cookies(sessionCookieName)),
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to change password")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to change password")
	}

	h.recordAuthEvent(c, session.UserID, "password_changed")
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) listSessions(c fiber.Ctx) error {
	current, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to read sessions")
	}
	if !ok {
		h.clearSessionCookie(c)
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}

	sessions, err := h.queries.ListUserSessions(
		c.Context(),
		db.ListUserSessionsParams{
			UserID: current.UserID,
			Token:  hashToken(c.Cookies(sessionCookieName)),
		},
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to read sessions")
	}

	response := make([]managedSessionResponse, 0, len(sessions))
	for _, session := range sessions {
		response = append(response, managedSessionFromRow(session))
	}
	return c.JSON(fiber.Map{"sessions": response})
}

func (h *Handler) revokeSession(c fiber.Ctx) error {
	current, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to revoke session")
	}
	if !ok {
		h.clearSessionCookie(c)
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}

	sessionID := c.Params("id")
	if sessionID == current.SessionID {
		return jsonError(c, fiber.StatusBadRequest, "The current session cannot be revoked")
	}
	if _, err := h.queries.RevokeUserSession(
		c.Context(),
		db.RevokeUserSessionParams{
			ID:     sessionID,
			UserID: current.UserID,
			Token:  hashToken(c.Cookies(sessionCookieName)),
		},
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusNotFound, "Session not found")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to revoke session")
	}
	h.recordAuthEvent(c, current.UserID, "session_revoked")
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) revokeOtherSessions(c fiber.Ctx) error {
	current, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to revoke sessions")
	}
	if !ok {
		h.clearSessionCookie(c)
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}

	if err := h.queries.DeleteOtherUserSessions(
		c.Context(),
		db.DeleteOtherUserSessionsParams{
			UserID: current.UserID,
			Token:  hashToken(c.Cookies(sessionCookieName)),
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to revoke sessions")
	}
	h.recordAuthEvent(c, current.UserID, "sessions_bulk_revoked")
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) recordAuthEvent(c fiber.Ctx, userID, eventType string) {
	eventID, err := randomValue(18)
	if err != nil {
		return
	}
	_ = h.queries.CreateAuthEvent(c.Context(), db.CreateAuthEventParams{
		ID:        eventID,
		UserID:    userID,
		EventType: eventType,
		IpAddress: textValue(c.IP()),
		UserAgent: textValue(c.Get("User-Agent")),
	})
	switch eventType {
	case "password_changed":
		h.createNotification(
			c.Context(), h.queries, userID, "security",
			"Password changed",
			"Your account password was changed.",
			"/account",
		)
	case "two_factor_enabled":
		h.createNotification(
			c.Context(), h.queries, userID, "security",
			"Two-factor authentication enabled",
			"Two-factor authentication is now protecting your account.",
			"/account",
		)
	case "two_factor_disabled":
		h.createNotification(
			c.Context(), h.queries, userID, "security",
			"Two-factor authentication disabled",
			"Two-factor authentication was removed from your account.",
			"/account",
		)
	case "email_verified":
		h.createNotification(
			c.Context(), h.queries, userID, "account",
			"Email verified",
			"Your email address has been verified successfully.",
			"/account",
		)
	}
}

func (h *Handler) currentSession(c fiber.Ctx) (db.GetSessionUserRow, bool, error) {
	rawToken := c.Cookies(sessionCookieName)
	if rawToken == "" {
		return db.GetSessionUserRow{}, false, nil
	}

	session, err := h.queries.GetSessionUser(c.Context(), hashToken(rawToken))
	if errors.Is(err, pgx.ErrNoRows) {
		return db.GetSessionUserRow{}, false, nil
	}
	return session, err == nil, err
}

func (h *Handler) setSessionCookie(
	c fiber.Ctx,
	token string,
	expiresAt time.Time,
) {
	c.Cookie(&fiber.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int(sessionLifetime.Seconds()),
		HTTPOnly: true,
		Secure:   h.cookieSecure,
		SameSite: fiber.CookieSameSiteLaxMode,
	})
}

func (h *Handler) clearSessionCookie(c fiber.Ctx) {
	c.Cookie(&fiber.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(1, 0),
		MaxAge:   -1,
		HTTPOnly: true,
		Secure:   h.cookieSecure,
		SameSite: fiber.CookieSameSiteLaxMode,
	})
}

func sessionParams(
	sessionID string,
	tokenHash string,
	userID string,
	expiresAt time.Time,
	c fiber.Ctx,
) db.CreateSessionParams {
	return db.CreateSessionParams{
		ID:        sessionID,
		ExpiresAt: timestampValue(expiresAt),
		Token:     tokenHash,
		IpAddress: textValue(c.IP()),
		UserAgent: textValue(c.Get("User-Agent")),
		UserID:    userID,
	}
}

func randomValue(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func newSessionToken() (raw string, hash string, err error) {
	raw, err = randomValue(32)
	if err != nil {
		return "", "", err
	}
	return raw, hashToken(raw), nil
}

func hashToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return hex.EncodeToString(hash[:])
}

func validEmail(value string) bool {
	address, err := mail.ParseAddress(value)
	return err == nil && strings.EqualFold(address.Address, value)
}

func validImageURL(value string) bool {
	imageURL, err := url.ParseRequestURI(value)
	return err == nil &&
		(imageURL.Scheme == "http" || imageURL.Scheme == "https") &&
		imageURL.Host != ""
}

func isUniqueViolation(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) && databaseError.Code == "23505"
}

func textValue(value string) pgtype.Text {
	return pgtype.Text{String: value, Valid: value != ""}
}

func timestampValue(value time.Time) pgtype.Timestamp {
	return pgtype.Timestamp{Time: value, Valid: true}
}

func activeBan(banned bool, expiresAt pgtype.Timestamp) bool {
	return banned &&
		(!expiresAt.Valid || expiresAt.Time.After(time.Now().UTC()))
}

func stringPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func sessionFromModel(session db.Session) sessionResponse {
	return sessionResponse{
		ID:                   session.ID,
		ExpiresAt:            session.ExpiresAt.Time,
		CreatedAt:            session.CreatedAt.Time,
		UpdatedAt:            session.UpdatedAt.Time,
		IPAddress:            stringPointer(session.IpAddress),
		UserAgent:            stringPointer(session.UserAgent),
		UserID:               session.UserID,
		ImpersonatedBy:       stringPointer(session.ImpersonatedBy),
		ActiveOrganizationID: stringPointer(session.ActiveOrganizationID),
		ActiveTeamID:         stringPointer(session.ActiveTeamID),
		ImpersonationReason:  stringPointer(session.ImpersonationReason),
	}
}

func sessionFromRow(row db.GetSessionUserRow) sessionResponse {
	return sessionResponse{
		ID:                   row.SessionID,
		ExpiresAt:            row.ExpiresAt.Time,
		CreatedAt:            row.CreatedAt.Time,
		UpdatedAt:            row.UpdatedAt.Time,
		IPAddress:            stringPointer(row.IpAddress),
		UserAgent:            stringPointer(row.UserAgent),
		UserID:               row.UserID,
		ImpersonatedBy:       stringPointer(row.ImpersonatedBy),
		ActiveOrganizationID: stringPointer(row.ActiveOrganizationID),
		ActiveTeamID:         stringPointer(row.ActiveTeamID),
		ImpersonationReason:  stringPointer(row.ImpersonationReason),
	}
}

func managedSessionFromRow(row db.ListUserSessionsRow) managedSessionResponse {
	return managedSessionResponse{
		sessionResponse: sessionResponse{
			ID:                   row.ID,
			ExpiresAt:            row.ExpiresAt.Time,
			CreatedAt:            row.CreatedAt.Time,
			UpdatedAt:            row.UpdatedAt.Time,
			IPAddress:            stringPointer(row.IpAddress),
			UserAgent:            stringPointer(row.UserAgent),
			UserID:               row.UserID,
			ImpersonatedBy:       stringPointer(row.ImpersonatedBy),
			ActiveOrganizationID: stringPointer(row.ActiveOrganizationID),
			ActiveTeamID:         stringPointer(row.ActiveTeamID),
		},
		Current: row.IsCurrent,
	}
}

func userFromModel(user db.User) userResponse {
	return userResponse{
		ID:            user.ID,
		Name:          user.Name,
		Email:         user.Email,
		EmailVerified: user.EmailVerified,
		Image:         stringPointer(user.Image),
		Role:          user.Role,
	}
}

func userFromCredentialRow(user db.GetCredentialUserByEmailRow) userResponse {
	return userResponse{
		ID:            user.ID,
		Name:          user.Name,
		Email:         user.Email,
		EmailVerified: user.EmailVerified,
		Image:         stringPointer(user.Image),
		Role:          user.Role,
	}
}

func userFromSessionRow(user db.GetSessionUserRow) userResponse {
	return userResponse{
		ID:            user.UserID,
		Name:          user.UserName,
		Email:         user.UserEmail,
		EmailVerified: user.UserEmailVerified,
		Image:         stringPointer(user.UserImage),
		Role:          user.UserRole,
	}
}

func jsonError(c fiber.Ctx, status int, message string) error {
	return c.Status(status).JSON(fiber.Map{"error": message})
}
