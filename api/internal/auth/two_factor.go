package auth

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image/png"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"

	"gc-go/api/internal/db"
)

type twoFactorPasswordRequest struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

type twoFactorCodeRequest struct {
	Code           string `json:"code"`
	ChallengeToken string `json:"challengeToken"`
}

func (h *Handler) twoFactorStatus(c fiber.Ctx) error {
	session, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to read two-factor status")
	}
	if !ok {
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}
	factor, err := h.queries.GetTwoFactorByUserID(c.Context(), session.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.JSON(fiber.Map{"enabled": false})
	}
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to read two-factor status")
	}
	return c.JSON(fiber.Map{"enabled": factor.Enabled})
}

func (h *Handler) setupTwoFactor(c fiber.Ctx) error {
	session, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to set up two-factor authentication")
	}
	if !ok {
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}
	var request twoFactorPasswordRequest
	if err := c.Bind().Body(&request); err != nil || request.Password == "" {
		return jsonError(c, fiber.StatusBadRequest, "Current password is required")
	}
	if !h.validUserPassword(c, session.UserID, request.Password) {
		return jsonError(c, fiber.StatusBadRequest, "Current password is incorrect")
	}
	existing, err := h.queries.GetTwoFactorByUserID(c.Context(), session.UserID)
	if err == nil && existing.Enabled {
		return jsonError(c, fiber.StatusConflict, "Two-factor authentication is already enabled")
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to set up two-factor authentication")
	}

	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "GC Go",
		AccountName: session.UserEmail,
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to set up two-factor authentication")
	}
	factorID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to set up two-factor authentication")
	}
	if _, err := h.queries.UpsertPendingTwoFactor(
		c.Context(),
		db.UpsertPendingTwoFactorParams{
			ID: factorID, UserID: session.UserID, Secret: key.Secret(),
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to set up two-factor authentication")
	}

	image, err := key.Image(256, 256)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create QR code")
	}
	var qr bytes.Buffer
	if err := png.Encode(&qr, image); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create QR code")
	}
	return c.JSON(fiber.Map{
		"secret": key.Secret(),
		"uri":    key.URL(),
		"qrCode": "data:image/png;base64," + base64.StdEncoding.EncodeToString(qr.Bytes()),
	})
}

func (h *Handler) enableTwoFactor(c fiber.Ctx) error {
	session, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to enable two-factor authentication")
	}
	if !ok {
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}
	var request twoFactorCodeRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Verification code is required")
	}
	factor, err := h.queries.GetTwoFactorByUserID(c.Context(), session.UserID)
	if err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Start two-factor setup first")
	}
	if factor.Enabled {
		return jsonError(c, fiber.StatusConflict, "Two-factor authentication is already enabled")
	}
	if !totp.Validate(strings.TrimSpace(request.Code), factor.Secret) {
		return jsonError(c, fiber.StatusBadRequest, "Verification code is incorrect")
	}
	codes, hashes, err := newRecoveryCodes(10)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to enable two-factor authentication")
	}
	encoded, _ := json.Marshal(hashes)
	if err := h.queries.EnableTwoFactor(c.Context(), db.EnableTwoFactorParams{
		UserID: session.UserID, BackupCodes: string(encoded),
	}); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to enable two-factor authentication")
	}
	h.recordAuthEvent(c, session.UserID, "two_factor_enabled")
	return c.JSON(fiber.Map{"recoveryCodes": codes})
}

func (h *Handler) disableTwoFactor(c fiber.Ctx) error {
	session, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to disable two-factor authentication")
	}
	if !ok {
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}
	var request twoFactorPasswordRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Password and verification code are required")
	}
	if !h.validUserPassword(c, session.UserID, request.Password) {
		return jsonError(c, fiber.StatusBadRequest, "Current password is incorrect")
	}
	factor, err := h.queries.GetTwoFactorByUserID(c.Context(), session.UserID)
	if err != nil || !factor.Enabled {
		return jsonError(c, fiber.StatusBadRequest, "Two-factor authentication is not enabled")
	}
	valid, _, err := verifyFactor(factor.Secret, factor.BackupCodes, request.Code)
	if err != nil || !valid {
		return jsonError(c, fiber.StatusBadRequest, "Verification code is incorrect")
	}
	if err := h.queries.DeleteTwoFactor(c.Context(), session.UserID); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to disable two-factor authentication")
	}
	h.recordAuthEvent(c, session.UserID, "two_factor_disabled")
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) verifyTwoFactorLogin(c fiber.Ctx) error {
	var request twoFactorCodeRequest
	if err := c.Bind().Body(&request); err != nil ||
		request.ChallengeToken == "" || request.Code == "" {
		return jsonError(c, fiber.StatusBadRequest, "Challenge and verification code are required")
	}
	challenge, err := h.queries.GetTwoFactorChallenge(
		c.Context(),
		hashToken(request.ChallengeToken),
	)
	if err != nil {
		return jsonError(c, fiber.StatusUnauthorized, "Login challenge is invalid or expired")
	}
	valid, remaining, err := verifyFactor(
		challenge.Secret,
		challenge.BackupCodes,
		request.Code,
	)
	if err != nil || !valid {
		return jsonError(c, fiber.StatusUnauthorized, "Verification code is incorrect")
	}

	rawToken, tokenHash, err := newSessionToken()
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
	}
	sessionID, _ := randomValue(18)
	expiresAt := time.Now().UTC().Add(sessionLifetime)
	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
	}
	defer transaction.Rollback(c.Context())
	queries := h.queries.WithTx(transaction)
	if remaining != nil {
		encoded, _ := json.Marshal(remaining)
		if err := queries.UpdateTwoFactorBackupCodes(
			c.Context(),
			db.UpdateTwoFactorBackupCodesParams{
				UserID: challenge.UserID, BackupCodes: string(encoded),
			},
		); err != nil {
			return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
		}
	}
	session, err := queries.CreateSession(c.Context(), sessionParams(
		sessionID, tokenHash, challenge.UserID, expiresAt, c,
	))
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
	}
	if err := queries.DeleteTwoFactorChallenge(c.Context(), challenge.ChallengeID); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to log in")
	}
	h.setSessionCookie(c, rawToken, expiresAt)
	h.recordAuthEvent(c, challenge.UserID, "two_factor_success")
	return c.JSON(fiber.Map{
		"session": sessionFromModel(session),
		"user": userResponse{
			ID: challenge.UserID, Name: challenge.Name, Email: challenge.Email,
			EmailVerified: challenge.EmailVerified,
			Image:         stringPointer(challenge.Image), Role: challenge.Role,
		},
	})
}

func (h *Handler) validUserPassword(c fiber.Ctx, userID, password string) bool {
	current, err := h.queries.GetCredentialPasswordByUserID(c.Context(), userID)
	return err == nil && current.Valid &&
		bcrypt.CompareHashAndPassword([]byte(current.String), []byte(password)) == nil
}

func verifyFactor(secret, encodedCodes, code string) (bool, []string, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if totp.Validate(code, secret) {
		return true, nil, nil
	}
	var hashes []string
	if err := json.Unmarshal([]byte(encodedCodes), &hashes); err != nil {
		return false, nil, err
	}
	for index, hash := range hashes {
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(code)) == nil {
			return true, append(hashes[:index], hashes[index+1:]...), nil
		}
	}
	return false, nil, nil
}

func newRecoveryCodes(count int) ([]string, []string, error) {
	codes := make([]string, 0, count)
	hashes := make([]string, 0, count)
	for range count {
		raw, err := randomValue(9)
		if err != nil {
			return nil, nil, err
		}
		code := strings.ToUpper(raw[:4] + "-" + raw[4:8] + "-" + raw[8:12])
		hash, err := bcrypt.GenerateFromPassword([]byte(code), bcrypt.DefaultCost)
		if err != nil {
			return nil, nil, err
		}
		codes = append(codes, code)
		hashes = append(hashes, string(hash))
	}
	return codes, hashes, nil
}
