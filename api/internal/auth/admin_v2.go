package auth

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"

	"gc-go/api/internal/db"
)

type adminBulkUsersRequest struct {
	Action         string   `json:"action"`
	UserIDs        []string `json:"userIds"`
	Reason         string   `json:"reason"`
	OrganizationID string   `json:"organizationId"`
}

type adminAuditEventResponse struct {
	ID          string          `json:"id"`
	EventType   string          `json:"eventType"`
	CreatedAt   time.Time       `json:"createdAt"`
	IPAddress   *string         `json:"ipAddress"`
	UserAgent   *string         `json:"userAgent"`
	TargetType  *string         `json:"targetType"`
	TargetID    *string         `json:"targetId"`
	Reason      *string         `json:"reason"`
	BeforeState json.RawMessage `json:"beforeState"`
	AfterState  json.RawMessage `json:"afterState"`
	ActorID     string          `json:"actorId"`
	ActorName   string          `json:"actorName"`
	ActorEmail  string          `json:"actorEmail"`
}

func (h *Handler) adminBulkUsers(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	var request adminBulkUsersRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	request.Action = strings.TrimSpace(request.Action)
	request.Reason = strings.TrimSpace(request.Reason)
	if len(request.UserIDs) == 0 || len(request.UserIDs) > 100 {
		return jsonError(c, fiber.StatusBadRequest, "Select between 1 and 100 users")
	}
	validActions := map[string]bool{
		"ban": true, "unban": true, "verify": true,
		"delete": true, "restore": true, "assign_organization": true,
	}
	if !validActions[request.Action] {
		return jsonError(c, fiber.StatusBadRequest, "Unsupported bulk action")
	}
	if request.Action == "ban" && request.Reason == "" {
		return jsonError(c, fiber.StatusBadRequest, "A ban reason is required")
	}
	if request.Action == "assign_organization" && request.OrganizationID == "" {
		return jsonError(c, fiber.StatusBadRequest, "Organization is required")
	}

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update users")
	}
	defer transaction.Rollback(c.Context())
	queries := h.queries.WithTx(transaction)

	for _, userID := range request.UserIDs {
		if userID == admin.UserID &&
			(request.Action == "ban" || request.Action == "delete") {
			return jsonError(c, fiber.StatusBadRequest, "You cannot modify your own account with this action")
		}
		before, err := queries.AdminGetUser(c.Context(), userID)
		if err != nil {
			return jsonError(c, fiber.StatusNotFound, "One or more users were not found")
		}

		switch request.Action {
		case "ban", "unban":
			banned := request.Action == "ban"
			after, err := queries.AdminSetUserBan(
				c.Context(),
				db.AdminSetUserBanParams{
					ID:        userID,
					Banned:    banned,
					BanReason: textValue(request.Reason),
				},
			)
			if err != nil {
				return jsonError(c, fiber.StatusInternalServerError, "Unable to update users")
			}
			if banned {
				if err := queries.DeleteAllUserSessions(c.Context(), userID); err != nil {
					return jsonError(c, fiber.StatusInternalServerError, "Unable to update users")
				}
			}
			h.recordAdminAuditWithQueries(c, queries, admin.UserID, "admin_bulk_"+request.Action, "user", userID, request.Reason, before, after)
		case "verify":
			if err := queries.MarkUserEmailVerified(c.Context(), userID); err != nil {
				return jsonError(c, fiber.StatusInternalServerError, "Unable to update users")
			}
			after, _ := queries.AdminGetUser(c.Context(), userID)
			h.recordAdminAuditWithQueries(c, queries, admin.UserID, "admin_bulk_verify", "user", userID, request.Reason, before, after)
		case "delete":
			if err := h.protectLastAdmin(c, userID, false); err != nil {
				return err
			}
			owned, err := queries.AdminCountOwnedOrganizations(c.Context(), userID)
			if err != nil || owned > 0 {
				return jsonError(c, fiber.StatusBadRequest, "Transfer organization ownership before deleting selected users")
			}
			after, err := queries.AdminSoftDeleteUser(c.Context(), userID)
			if err != nil {
				return jsonError(c, fiber.StatusBadRequest, "One or more users are already deleted")
			}
			if err := queries.DeleteAllUserSessions(c.Context(), userID); err != nil {
				return jsonError(c, fiber.StatusInternalServerError, "Unable to update users")
			}
			h.recordAdminAuditWithQueries(c, queries, admin.UserID, "admin_bulk_delete", "user", userID, request.Reason, before, after)
		case "restore":
			after, err := queries.AdminRestoreUser(c.Context(), userID)
			if err != nil {
				if isUniqueViolation(err) {
					return jsonError(c, fiber.StatusConflict, "A restored email conflicts with an active account")
				}
				return jsonError(c, fiber.StatusBadRequest, "One or more users are not deleted")
			}
			h.recordAdminAuditWithQueries(c, queries, admin.UserID, "admin_bulk_restore", "user", userID, request.Reason, before, after)
		case "assign_organization":
			organization, err := queries.AdminGetOrganization(
				c.Context(),
				request.OrganizationID,
			)
			if err != nil || organization.DeletedAt.Valid {
				return jsonError(c, fiber.StatusBadRequest, "Organization is unavailable")
			}
			memberID, err := randomValue(18)
			if err != nil {
				return jsonError(c, fiber.StatusInternalServerError, "Unable to update users")
			}
			if err := queries.AdminUpsertOrganizationMember(
				c.Context(),
				db.AdminUpsertOrganizationMemberParams{
					ID:             memberID,
					OrganizationID: request.OrganizationID,
					UserID:         userID,
					Role:           "member",
				},
			); err != nil {
				return jsonError(c, fiber.StatusInternalServerError, "Unable to update users")
			}
			h.recordAdminAuditWithQueries(c, queries, admin.UserID, "admin_bulk_assign_organization", "user", userID, request.Reason, before, fiber.Map{"organizationId": request.OrganizationID})
		}
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update users")
	}
	return c.JSON(fiber.Map{"updated": len(request.UserIDs)})
}

func (h *Handler) adminListAuditEvents(c fiber.Ctx) error {
	if _, ok := h.requirePlatformAdmin(c); !ok {
		return nil
	}
	page, pageSize := adminPagination(c)
	search := strings.TrimSpace(c.Query("search"))
	events, err := h.queries.AdminListAuditEvents(
		c.Context(),
		db.AdminListAuditEventsParams{
			Search:     search,
			PageOffset: int32((page - 1) * pageSize),
			PageSize:   int32(pageSize),
		},
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load audit events")
	}
	total, err := h.queries.AdminCountAuditEvents(c.Context(), search)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load audit events")
	}
	response := make([]adminAuditEventResponse, 0, len(events))
	for _, event := range events {
		response = append(response, adminAuditEventResponse{
			ID:          event.ID,
			EventType:   event.EventType,
			CreatedAt:   event.CreatedAt.Time,
			IPAddress:   stringPointer(event.IpAddress),
			UserAgent:   stringPointer(event.UserAgent),
			TargetType:  stringPointer(event.TargetType),
			TargetID:    stringPointer(event.TargetID),
			Reason:      stringPointer(event.Reason),
			BeforeState: nullableJSON(event.BeforeState),
			AfterState:  nullableJSON(event.AfterState),
			ActorID:     event.ActorID,
			ActorName:   event.ActorName,
			ActorEmail:  event.ActorEmail,
		})
	}
	return c.JSON(fiber.Map{
		"events": response,
		"pagination": fiber.Map{
			"page": page, "pageSize": pageSize, "total": total,
		},
	})
}

func (h *Handler) adminDashboard(c fiber.Ctx) error {
	if _, ok := h.requirePlatformAdmin(c); !ok {
		return nil
	}
	metrics, err := h.queries.AdminDashboardMetrics(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load admin dashboard")
	}
	growth, err := h.queries.AdminUserGrowth(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load admin dashboard")
	}
	activity := make([]fiber.Map, 0, len(growth))
	for _, day := range growth {
		activity = append(activity, fiber.Map{
			"date":  day.Day.Time.Format(time.DateOnly),
			"users": day.Users,
		})
	}
	return c.JSON(fiber.Map{
		"totalUsers":         metrics.TotalUsers,
		"bannedUsers":        metrics.BannedUsers,
		"verifiedUsers":      metrics.VerifiedUsers,
		"totalOrganizations": metrics.TotalOrganizations,
		"activeSessions":     metrics.ActiveSessions,
		"pendingInvitations": metrics.PendingInvitations,
		"userGrowth":         activity,
	})
}

func (h *Handler) recordAdminAudit(
	c fiber.Ctx,
	actorID string,
	eventType string,
	targetType string,
	targetID string,
	reason string,
	before any,
	after any,
) {
	h.recordAdminAuditWithQueries(
		c, h.queries, actorID, eventType, targetType, targetID,
		reason, before, after,
	)
}

func (h *Handler) recordAdminAuditWithQueries(
	c fiber.Ctx,
	queries *db.Queries,
	actorID string,
	eventType string,
	targetType string,
	targetID string,
	reason string,
	before any,
	after any,
) {
	eventID, err := randomValue(18)
	if err != nil {
		return
	}
	beforeJSON, _ := json.Marshal(before)
	afterJSON, _ := json.Marshal(after)
	if before == nil {
		beforeJSON = nil
	}
	if after == nil {
		afterJSON = nil
	}
	_ = queries.CreateAuthEvent(c.Context(), db.CreateAuthEventParams{
		ID:          eventID,
		UserID:      actorID,
		EventType:   eventType,
		IpAddress:   textValue(c.IP()),
		UserAgent:   textValue(c.Get("User-Agent")),
		TargetType:  textValue(targetType),
		TargetID:    textValue(targetID),
		Reason:      textValue(reason),
		BeforeState: beforeJSON,
		AfterState:  afterJSON,
	})
}

func adminPagination(c fiber.Ctx) (int, int) {
	page, _ := strconv.Atoi(c.Query("page", "1"))
	pageSize, _ := strconv.Atoi(c.Query("pageSize", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func nullableJSON(value []byte) json.RawMessage {
	if len(value) == 0 {
		return nil
	}
	return value
}

func isNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
