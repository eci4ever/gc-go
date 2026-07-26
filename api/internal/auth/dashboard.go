package auth

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"

	"gc-go/api/internal/db"
)

type signInActivityResponse struct {
	Date    string `json:"date"`
	SignIns int32  `json:"signIns"`
}

func (h *Handler) RegisterDashboard(router fiber.Router) {
	router.Get("/dashboard", h.dashboard)
}

func (h *Handler) dashboard(c fiber.Ctx) error {
	current, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load dashboard")
	}
	if !ok {
		h.clearSessionCookie(c)
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}

	activeSessions, err := h.queries.CountActiveUserSessions(
		c.Context(),
		current.UserID,
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load dashboard")
	}
	activity, err := h.queries.GetUserSignInActivity(c.Context(), current.UserID)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load dashboard")
	}
	sessions, err := h.queries.ListUserSessions(
		c.Context(),
		db.ListUserSessionsParams{
			UserID: current.UserID,
			Token:  hashToken(c.Cookies(sessionCookieName)),
		},
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load dashboard")
	}

	twoFactorEnabled := false
	factor, err := h.queries.GetTwoFactorByUserID(c.Context(), current.UserID)
	if err == nil {
		twoFactorEnabled = factor.Enabled
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load dashboard")
	}

	securityScore := 30
	if current.UserEmailVerified {
		securityScore += 30
	}
	if twoFactorEnabled {
		securityScore += 40
	}

	signIns := make([]signInActivityResponse, 0, len(activity))
	for _, day := range activity {
		signIns = append(signIns, signInActivityResponse{
			Date:    day.Day.Time.Format(time.DateOnly),
			SignIns: day.SignIns,
		})
	}
	recentSessions := make([]managedSessionResponse, 0, min(3, len(sessions)))
	for index, session := range sessions {
		if index == 3 {
			break
		}
		recentSessions = append(recentSessions, managedSessionFromRow(session))
	}

	return c.JSON(fiber.Map{
		"securityScore":    securityScore,
		"activeSessions":   activeSessions,
		"twoFactorEnabled": twoFactorEnabled,
		"emailVerified":    current.UserEmailVerified,
		"signInActivity":   signIns,
		"recentSessions":   recentSessions,
	})
}
