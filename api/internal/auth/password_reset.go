package auth

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"gc-go/api/internal/db"
)

type forgotPasswordRequest struct {
	Email string `json:"email"`
}

type resetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

func (h *Handler) forgotPassword(c fiber.Ctx) error {
	var request forgotPasswordRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	request.Email = strings.ToLower(strings.TrimSpace(request.Email))
	if !validEmail(request.Email) {
		return jsonError(c, fiber.StatusBadRequest, "Enter a valid email address")
	}

	// Always return the same response for existing and unknown accounts.
	if h.emailSender == nil {
		return c.SendStatus(fiber.StatusNoContent)
	}
	user, err := h.queries.GetPasswordResetUserByEmail(c.Context(), request.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return c.SendStatus(fiber.StatusNoContent)
	}
	if err != nil {
		log.Printf("find password reset user: %v", err)
		return c.SendStatus(fiber.StatusNoContent)
	}

	if _, err := h.queries.GetRecentEmailVerification(
		c.Context(),
		user.Email,
	); err == nil {
		return c.SendStatus(fiber.StatusNoContent)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		log.Printf("check recent password reset: %v", err)
		return c.SendStatus(fiber.StatusNoContent)
	}

	if err := h.createAndSendPasswordReset(c.Context(), user); err != nil {
		log.Printf("send password reset email: %v", err)
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) resetPassword(c fiber.Ctx) error {
	var request resetPasswordRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if request.Token == "" {
		return jsonError(c, fiber.StatusBadRequest, "Reset token is required")
	}
	if len(request.NewPassword) < 8 || len(request.NewPassword) > 72 {
		return jsonError(
			c,
			fiber.StatusBadRequest,
			"Password must be between 8 and 72 characters",
		)
	}

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to reset password")
	}
	defer transaction.Rollback(c.Context())

	queries := h.queries.WithTx(transaction)
	reset, err := queries.GetActivePasswordReset(c.Context(), hashToken(request.Token))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusBadRequest, "Reset link is invalid or has expired")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to reset password")
	}
	if reset.Password.Valid &&
		bcrypt.CompareHashAndPassword(
			[]byte(reset.Password.String),
			[]byte(request.NewPassword),
		) == nil {
		return jsonError(c, fiber.StatusBadRequest, "New password must be different")
	}

	passwordHash, err := bcrypt.GenerateFromPassword(
		[]byte(request.NewPassword),
		bcrypt.DefaultCost,
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to reset password")
	}
	if err := queries.UpdateCredentialPassword(
		c.Context(),
		db.UpdateCredentialPasswordParams{
			UserID:   reset.UserID,
			Password: textValue(string(passwordHash)),
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to reset password")
	}
	if err := queries.DeleteAllUserSessions(c.Context(), reset.UserID); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to reset password")
	}
	if err := queries.DeleteEmailVerification(c.Context(), reset.ID); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to reset password")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to reset password")
	}

	h.clearSessionCookie(c)
	h.recordAuthEvent(c, reset.UserID, "password_reset")
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) createAndSendPasswordReset(
	ctx context.Context,
	user db.GetPasswordResetUserByEmailRow,
) error {
	rawToken, tokenHash, err := newSessionToken()
	if err != nil {
		return err
	}
	resetID, err := randomValue(18)
	if err != nil {
		return err
	}

	transaction, err := h.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)

	queries := h.queries.WithTx(transaction)
	if err := queries.DeleteUserEmailVerifications(ctx, user.Email); err != nil {
		return err
	}
	if err := queries.CreateEmailVerification(
		ctx,
		db.CreateEmailVerificationParams{
			ID:         resetID,
			Identifier: user.Email,
			Value:      tokenHash,
			ExpiresAt:  timestampValue(time.Now().UTC().Add(verificationLifetime)),
		},
	); err != nil {
		return err
	}
	if err := transaction.Commit(ctx); err != nil {
		return err
	}

	resetURL := fmt.Sprintf(
		"%s/reset-password?token=%s",
		h.appURL,
		url.QueryEscape(rawToken),
	)
	if err := h.emailSender.SendPasswordReset(
		ctx,
		user.Email,
		user.Name,
		resetURL,
	); err != nil {
		_ = h.queries.DeleteEmailVerification(context.Background(), resetID)
		return err
	}
	return nil
}
