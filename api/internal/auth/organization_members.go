package auth

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"gc-go/api/internal/db"
)

type organizationMemberRequest struct {
	UserID string `json:"userId"`
	Role   string `json:"role"`
}

type organizationInvitationRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

type acceptInvitationRequest struct {
	Token string `json:"token"`
}

func (h *Handler) adminListOrganizationMembers(c fiber.Ctx) error {
	if _, ok := h.requirePlatformAdmin(c); !ok {
		return nil
	}
	organizationID := c.Params("id")
	if _, err := h.queries.AdminGetOrganization(c.Context(), organizationID); err != nil {
		return jsonError(c, fiber.StatusNotFound, "Organization not found")
	}
	members, err := h.queries.AdminListOrganizationMembers(
		c.Context(),
		organizationID,
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load members")
	}
	invitations, err := h.queries.AdminListOrganizationInvitations(
		c.Context(),
		organizationID,
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load invitations")
	}
	return c.JSON(fiber.Map{
		"members":     members,
		"invitations": invitations,
	})
}

func (h *Handler) adminAddOrganizationMember(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	organizationID := c.Params("id")
	var request organizationMemberRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if !validOrganizationMemberRole(request.Role) {
		return jsonError(c, fiber.StatusBadRequest, "Role must be admin or member")
	}
	user, err := h.queries.AdminGetUser(c.Context(), request.UserID)
	if err != nil || user.DeletedAt.Valid || activeBan(user.Banned, user.BanExpires) {
		return jsonError(c, fiber.StatusBadRequest, "Select an active user")
	}
	organization, err := h.queries.AdminGetOrganization(c.Context(), organizationID)
	if err != nil || organization.DeletedAt.Valid {
		return jsonError(c, fiber.StatusNotFound, "Organization not found")
	}
	memberID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to add member")
	}
	if err := h.queries.AdminUpsertOrganizationMember(
		c.Context(),
		db.AdminUpsertOrganizationMemberParams{
			ID:             memberID,
			OrganizationID: organizationID,
			UserID:         request.UserID,
			Role:           request.Role,
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to add member")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_organization_member_added", "organization", organizationID, "", nil, request)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) adminUpdateOrganizationMember(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	organizationID := c.Params("id")
	userID := c.Params("userId")
	var request organizationMemberRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	if !validOrganizationMemberRole(request.Role) {
		return jsonError(c, fiber.StatusBadRequest, "Role must be admin or member")
	}
	before, err := h.queries.AdminGetOrganizationMember(
		c.Context(),
		db.AdminGetOrganizationMemberParams{
			OrganizationID: organizationID,
			UserID:         userID,
		},
	)
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "Organization member not found")
	}
	if before.Role == "owner" {
		return jsonError(c, fiber.StatusBadRequest, "Transfer ownership before changing the owner role")
	}
	memberID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update member")
	}
	if err := h.queries.AdminUpsertOrganizationMember(
		c.Context(),
		db.AdminUpsertOrganizationMemberParams{
			ID:             memberID,
			OrganizationID: organizationID,
			UserID:         userID,
			Role:           request.Role,
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update member")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_organization_member_updated", "organization", organizationID, "", before, request)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) adminDeleteOrganizationMember(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	organizationID := c.Params("id")
	userID := c.Params("userId")
	member, err := h.queries.AdminGetOrganizationMember(
		c.Context(),
		db.AdminGetOrganizationMemberParams{
			OrganizationID: organizationID,
			UserID:         userID,
		},
	)
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "Organization member not found")
	}
	if member.Role == "owner" {
		return jsonError(c, fiber.StatusBadRequest, "Transfer ownership before removing the owner")
	}
	if _, err := h.queries.AdminDeleteOrganizationMember(
		c.Context(),
		db.AdminDeleteOrganizationMemberParams{
			OrganizationID: organizationID,
			UserID:         userID,
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to remove member")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_organization_member_removed", "organization", organizationID, "", member, nil)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) adminInviteOrganizationMember(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	organizationID := c.Params("id")
	var request organizationInvitationRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	request.Email = strings.ToLower(strings.TrimSpace(request.Email))
	request.Role = strings.ToLower(strings.TrimSpace(request.Role))
	if !validEmail(request.Email) || !validOrganizationMemberRole(request.Role) {
		return jsonError(c, fiber.StatusBadRequest, "Enter a valid email and role")
	}
	if h.emailSender == nil {
		return jsonError(c, fiber.StatusServiceUnavailable, "Email delivery is not configured")
	}
	organization, err := h.queries.AdminGetOrganization(c.Context(), organizationID)
	if err != nil || organization.DeletedAt.Valid {
		return jsonError(c, fiber.StatusNotFound, "Organization not found")
	}

	rawToken, tokenHash, err := newSessionToken()
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to send invitation")
	}
	invitationID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to send invitation")
	}
	var invitedUserID pgtype.Text
	if user, err := h.queries.GetCredentialUserByEmail(c.Context(), request.Email); err == nil {
		invitedUserID = textValue(user.ID)
	}

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to send invitation")
	}
	defer transaction.Rollback(c.Context())
	queries := h.queries.WithTx(transaction)
	if err := queries.AdminDeletePendingOrganizationInvitations(
		c.Context(),
		db.AdminDeletePendingOrganizationInvitationsParams{
			OrganizationID: organizationID,
			Email:          request.Email,
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to send invitation")
	}
	invitation, err := queries.AdminCreateOrganizationInvitation(
		c.Context(),
		db.AdminCreateOrganizationInvitationParams{
			ID:             invitationID,
			OrganizationID: organizationID,
			Email:          request.Email,
			Role:           textValue(request.Role),
			ExpiresAt:      timestampValue(time.Now().UTC().Add(7 * 24 * time.Hour)),
			InviterID:      admin.UserID,
			Token:          textValue(tokenHash),
			InvitedUserID:  invitedUserID,
		},
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to send invitation")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to send invitation")
	}

	invitationURL := fmt.Sprintf(
		"%s/accept-invitation?token=%s",
		h.appURL,
		url.QueryEscape(rawToken),
	)
	if err := h.emailSender.SendOrganizationInvitation(
		c.Context(),
		request.Email,
		organization.Name,
		invitationURL,
	); err != nil {
		_, _ = h.queries.AdminCancelOrganizationInvitation(
			context.Background(),
			db.AdminCancelOrganizationInvitationParams{
				ID:             invitationID,
				OrganizationID: organizationID,
			},
		)
		return jsonError(c, fiber.StatusBadGateway, "Unable to send invitation")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_organization_invitation_sent", "organization", organizationID, "", nil, invitation)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"invitation": invitation})
}

func (h *Handler) adminCancelOrganizationInvitation(c fiber.Ctx) error {
	admin, ok := h.requirePlatformAdmin(c)
	if !ok {
		return nil
	}
	organizationID := c.Params("id")
	invitationID := c.Params("invitationId")
	if _, err := h.queries.AdminCancelOrganizationInvitation(
		c.Context(),
		db.AdminCancelOrganizationInvitationParams{
			ID:             invitationID,
			OrganizationID: organizationID,
		},
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return jsonError(c, fiber.StatusNotFound, "Pending invitation not found")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to cancel invitation")
	}
	h.recordAdminAudit(c, admin.UserID, "admin_organization_invitation_cancelled", "organization", organizationID, "", fiber.Map{"invitationId": invitationID}, nil)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) acceptOrganizationInvitation(c fiber.Ctx) error {
	current, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to accept invitation")
	}
	if !ok {
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}
	var request acceptInvitationRequest
	if err := c.Bind().Body(&request); err != nil || request.Token == "" {
		return jsonError(c, fiber.StatusBadRequest, "Invitation token is required")
	}

	transaction, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to accept invitation")
	}
	defer transaction.Rollback(c.Context())
	queries := h.queries.WithTx(transaction)
	invitation, err := queries.GetActiveOrganizationInvitation(
		c.Context(),
		db.GetActiveOrganizationInvitationParams{
			Token: hashToken(request.Token),
			Email: current.UserEmail,
		},
	)
	if err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invitation is invalid, expired, or belongs to another email")
	}
	memberID, err := randomValue(18)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to accept invitation")
	}
	role := invitation.Role.String
	if !validOrganizationMemberRole(role) {
		role = "member"
	}
	if err := queries.AdminUpsertOrganizationMember(
		c.Context(),
		db.AdminUpsertOrganizationMemberParams{
			ID:             memberID,
			OrganizationID: invitation.OrganizationID,
			UserID:         current.UserID,
			Role:           role,
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to accept invitation")
	}
	if err := queries.AcceptOrganizationInvitation(
		c.Context(),
		db.AcceptOrganizationInvitationParams{
			ID:            invitation.ID,
			InvitedUserID: textValue(current.UserID),
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to accept invitation")
	}
	if err := transaction.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to accept invitation")
	}
	h.recordAuthEvent(c, current.UserID, "organization_invitation_accepted")
	return c.JSON(fiber.Map{
		"organizationId":   invitation.OrganizationID,
		"organizationName": invitation.OrganizationName,
	})
}

func validOrganizationMemberRole(role string) bool {
	return role == "admin" || role == "member"
}
