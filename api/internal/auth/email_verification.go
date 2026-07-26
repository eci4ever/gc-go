package auth

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"

	"gc-go/api/internal/db"
)

type verifyEmailRequest struct {
	Token string `json:"token"`
}

func (h *Handler) sendEmailVerification(c fiber.Ctx) error {
	session, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to read session")
	}
	if !ok {
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}
	if session.UserEmailVerified {
		return jsonError(c, fiber.StatusBadRequest, "Email is already verified")
	}
	if h.emailSender == nil {
		return jsonError(c, fiber.StatusServiceUnavailable, "Email delivery is not configured")
	}

	_, err = h.queries.GetRecentEmailVerification(c.Context(), session.UserID)
	if err == nil {
		return jsonError(c, fiber.StatusTooManyRequests, "Please wait before requesting another email")
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to send verification email")
	}

	user := db.User{
		ID:    session.UserID,
		Name:  session.UserName,
		Email: session.UserEmail,
	}
	if err := h.createAndSendEmailVerification(c.Context(), user); err != nil {
		return jsonError(c, fiber.StatusBadGateway, "Unable to send verification email")
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) verifyEmail(c fiber.Ctx) error {
	var request verifyEmailRequest
	if err := c.Bind().Body(&request); err != nil || request.Token == "" {
		return jsonError(c, fiber.StatusBadRequest, "Verification token is required")
	}

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to verify email")
	}
	defer transaction.Rollback(c.Context())

	queries := h.queries.WithTx(transaction)
	verification, err := queries.GetActiveEmailVerification(
		c.Context(),
		hashToken(request.Token),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusBadRequest, "Verification link is invalid or has expired")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to verify email")
	}
	if err := queries.MarkUserEmailVerified(c.Context(), verification.UserID); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to verify email")
	}
	if err := queries.DeleteUserEmailVerifications(c.Context(), verification.UserID); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to verify email")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to verify email")
	}

	h.recordAuthEvent(c, verification.UserID, "email_verified")
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) createAndSendEmailVerification(
	ctx context.Context,
	user db.User,
) error {
	if h.emailSender == nil {
		return nil
	}

	rawToken, tokenHash, err := newSessionToken()
	if err != nil {
		return err
	}
	verificationID, err := randomValue(18)
	if err != nil {
		return err
	}

	transaction, err := h.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer transaction.Rollback(ctx)

	queries := h.queries.WithTx(transaction)
	if err := queries.DeleteUserEmailVerifications(ctx, user.ID); err != nil {
		return err
	}
	if err := queries.CreateEmailVerification(
		ctx,
		db.CreateEmailVerificationParams{
			ID:         verificationID,
			Identifier: user.ID,
			Value:      tokenHash,
			ExpiresAt:  timestampValue(time.Now().UTC().Add(verificationLifetime)),
		},
	); err != nil {
		return err
	}
	if err := transaction.Commit(ctx); err != nil {
		return err
	}

	verificationURL := fmt.Sprintf(
		"%s/verify-email?token=%s",
		h.appURL,
		url.QueryEscape(rawToken),
	)
	if err := h.emailSender.SendVerification(
		ctx,
		user.Email,
		user.Name,
		verificationURL,
	); err != nil {
		_ = h.queries.DeleteEmailVerification(context.Background(), verificationID)
		return err
	}
	return nil
}
