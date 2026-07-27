package auth

import (
	"context"
	"errors"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"gc-go/api/internal/db"
)

type notificationQueries interface {
	CreateNotification(
		context.Context,
		db.CreateNotificationParams,
	) (db.Notification, error)
}

func (h *Handler) listNotifications(c fiber.Ctx) error {
	current, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load notifications")
	}
	if !ok {
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}

	notifications, err := h.queries.ListUserNotifications(
		c.Context(),
		db.ListUserNotificationsParams{UserID: current.UserID, Limit: 30},
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load notifications")
	}
	unreadCount, err := h.queries.CountUnreadUserNotifications(
		c.Context(),
		current.UserID,
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load notifications")
	}

	return c.JSON(fiber.Map{
		"notifications": notifications,
		"unreadCount":   unreadCount,
	})
}

func (h *Handler) markNotificationRead(c fiber.Ctx) error {
	current, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update notification")
	}
	if !ok {
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}

	_, err = h.queries.MarkUserNotificationRead(
		c.Context(),
		db.MarkUserNotificationReadParams{
			ID:     c.Params("id"),
			UserID: current.UserID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return jsonError(c, fiber.StatusNotFound, "Notification not found")
	}
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update notification")
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) markAllNotificationsRead(c fiber.Ctx) error {
	current, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update notifications")
	}
	if !ok {
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}

	updated, err := h.queries.MarkAllUserNotificationsRead(
		c.Context(),
		current.UserID,
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update notifications")
	}
	return c.JSON(fiber.Map{"updated": updated})
}

func (h *Handler) createNotification(
	ctx context.Context,
	queries notificationQueries,
	userID string,
	notificationType string,
	title string,
	body string,
	href string,
) {
	id, err := randomValue(18)
	if err != nil {
		return
	}
	var link pgtype.Text
	if href != "" {
		link = textValue(href)
	}
	_, _ = queries.CreateNotification(ctx, db.CreateNotificationParams{
		ID:     id,
		UserID: userID,
		Type:   notificationType,
		Title:  title,
		Body:   body,
		Href:   link,
	})
}
