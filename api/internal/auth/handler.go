package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/mail"
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
	sessionCookieName = "gc_go_session"
	sessionLifetime   = 7 * 24 * time.Hour
)

type Handler struct {
	pool         *pgxpool.Pool
	queries      *db.Queries
	cookieSecure bool
}

type credentialsRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type userResponse struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Email         string  `json:"email"`
	EmailVerified bool    `json:"emailVerified"`
	Image         *string `json:"image"`
	Role          string  `json:"role"`
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

func (h *Handler) Register(router fiber.Router) {
	router.Post("/signup", h.signup)
	router.Post("/login", h.login)
	router.Post("/logout", h.logout)
	router.Get("/session", h.session)
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
	if err := queries.CreateSession(c.Context(), sessionParams(
		sessionID,
		tokenHash,
		userID,
		expiresAt,
		c,
	)); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create account")
	}

	h.setSessionCookie(c, rawToken, expiresAt)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"user": userFromModel(user),
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
	if user.Banned.Valid && user.Banned.Bool {
		return jsonError(c, fiber.StatusForbidden, "This account is unavailable")
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
	if err := h.queries.CreateSession(c.Context(), sessionParams(
		sessionID,
		tokenHash,
		user.ID,
		expiresAt,
		c,
	)); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
	}

	h.setSessionCookie(c, rawToken, expiresAt)
	return c.JSON(fiber.Map{
		"user": userFromCredentialRow(user),
	})
}

func (h *Handler) session(c fiber.Ctx) error {
	rawToken := c.Cookies(sessionCookieName)
	if rawToken == "" {
		return c.JSON(fiber.Map{"user": nil})
	}

	user, err := h.queries.GetSessionUser(c.Context(), hashToken(rawToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			h.clearSessionCookie(c)
			return c.JSON(fiber.Map{"user": nil})
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to read session")
	}

	return c.JSON(fiber.Map{
		"user": userFromSessionRow(user),
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

func stringPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
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
		ID:            user.ID,
		Name:          user.Name,
		Email:         user.Email,
		EmailVerified: user.EmailVerified,
		Image:         stringPointer(user.Image),
		Role:          user.Role,
	}
}

func jsonError(c fiber.Ctx, status int, message string) error {
	return c.Status(status).JSON(fiber.Map{"error": message})
}
