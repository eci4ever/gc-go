package auth

import (
	"context"
	"encoding/json"
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

type organizationAccess struct {
	Current db.GetSessionUserRow
	Org     db.GetOrganizationMembershipRow
}

type organizationSettingsRequest struct {
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	Logo     string `json:"logo"`
	Metadata string `json:"metadata"`
}

type organizationRoleRequest struct {
	Role string `json:"role"`
}

type organizationTeamRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	LeadUserID  string `json:"leadUserId"`
}

type organizationArchiveTeamRequest struct {
	Archived bool `json:"archived"`
}

type organizationTeamMemberRequest struct {
	UserID string `json:"userId"`
}

type transferOwnershipRequest struct {
	UserID string `json:"userId"`
	Reason string `json:"reason"`
}

func (h *Handler) RegisterOrganizations(router fiber.Router) {
	router.Get("/", h.listMyOrganizations)
	router.Post("/:slug/activate", h.activateOrganization)
	router.Get("/:slug", h.getOrganizationWorkspace)
	router.Put("/:slug", h.updateOrganizationWorkspace)
	router.Get("/:slug/members", h.listOrganizationWorkspaceMembers)
	router.Put("/:slug/members/:userId", h.updateOrganizationWorkspaceMember)
	router.Delete("/:slug/members/:userId", h.deleteOrganizationWorkspaceMember)
	router.Post("/:slug/invitations", h.inviteOrganizationWorkspaceMember)
	router.Delete("/:slug/invitations/:invitationId", h.cancelOrganizationWorkspaceInvitation)
	router.Get("/:slug/teams", h.listOrganizationWorkspaceTeams)
	router.Post("/:slug/teams", h.createOrganizationWorkspaceTeam)
	router.Put("/:slug/teams/:teamId", h.updateOrganizationWorkspaceTeam)
	router.Post("/:slug/teams/:teamId/archive", h.archiveOrganizationWorkspaceTeam)
	router.Delete("/:slug/teams/:teamId", h.deleteOrganizationWorkspaceTeam)
	router.Get("/:slug/teams/:teamId/members", h.listOrganizationWorkspaceTeamMembers)
	router.Post("/:slug/teams/:teamId/members", h.addOrganizationWorkspaceTeamMember)
	router.Delete("/:slug/teams/:teamId/members/:userId", h.deleteOrganizationWorkspaceTeamMember)
	router.Post("/:slug/transfer-ownership", h.transferOrganizationWorkspaceOwnership)
	router.Post("/:slug/leave", h.leaveOrganizationWorkspace)
	router.Get("/:slug/audit-events", h.listOrganizationWorkspaceAudit)
}

func (h *Handler) organizationAccess(c fiber.Ctx, roles ...string) (organizationAccess, bool) {
	current, ok, err := h.currentSession(c)
	if err != nil {
		_ = jsonError(c, fiber.StatusInternalServerError, "Unable to verify organization access")
		return organizationAccess{}, false
	}
	if !ok {
		_ = jsonError(c, fiber.StatusUnauthorized, "Authentication required")
		return organizationAccess{}, false
	}
	membership, err := h.queries.GetOrganizationMembership(
		c.Context(),
		db.GetOrganizationMembershipParams{
			Slug: c.Params("slug"), UserID: current.UserID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		_ = jsonError(c, fiber.StatusNotFound, "Organization not found")
		return organizationAccess{}, false
	}
	if err != nil {
		_ = jsonError(c, fiber.StatusInternalServerError, "Unable to verify organization access")
		return organizationAccess{}, false
	}
	if len(roles) > 0 && !containsRole(membership.Role, roles) {
		_ = jsonError(c, fiber.StatusForbidden, "You do not have permission for this action")
		return organizationAccess{}, false
	}
	return organizationAccess{Current: current, Org: membership}, true
}

func containsRole(role string, roles []string) bool {
	for _, allowed := range roles {
		if role == allowed {
			return true
		}
	}
	return false
}

func (h *Handler) listMyOrganizations(c fiber.Ctx) error {
	current, ok, err := h.currentSession(c)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load organizations")
	}
	if !ok {
		return jsonError(c, fiber.StatusUnauthorized, "Authentication required")
	}
	organizations, err := h.queries.ListUserOrganizations(c.Context(), current.UserID)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load organizations")
	}
	return c.JSON(fiber.Map{
		"organizations":        organizations,
		"activeOrganizationId": stringPointer(current.ActiveOrganizationID),
	})
}

func (h *Handler) getOrganizationWorkspace(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c)
	if !ok {
		return nil
	}
	return c.JSON(fiber.Map{"organization": access.Org})
}

func (h *Handler) activateOrganization(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c)
	if !ok {
		return nil
	}
	if err := h.queries.SetSessionActiveOrganization(
		c.Context(),
		db.SetSessionActiveOrganizationParams{
			ID: access.Current.SessionID, ActiveOrganizationID: textValue(access.Org.ID),
			UserID: access.Current.UserID,
		},
	); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to switch organization")
	}
	return c.JSON(fiber.Map{"activeOrganizationId": access.Org.ID})
}

func (h *Handler) updateOrganizationWorkspace(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner")
	if !ok {
		return nil
	}
	var request organizationSettingsRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	request.Name = strings.TrimSpace(request.Name)
	request.Slug = strings.ToLower(strings.TrimSpace(request.Slug))
	if request.Name == "" || len(request.Name) > 100 ||
		!organizationSlugPattern.MatchString(request.Slug) {
		return jsonError(c, fiber.StatusBadRequest, "Enter a valid name and slug")
	}
	updated, err := h.queries.UpdateOrganizationWorkspace(
		c.Context(),
		db.UpdateOrganizationWorkspaceParams{
			ID: access.Org.ID, Name: request.Name, Slug: request.Slug,
			Logo: optionalText(request.Logo), Metadata: optionalText(request.Metadata),
		},
	)
	if err != nil {
		if isUniqueViolation(err) {
			return jsonError(c, fiber.StatusConflict, "Organization slug is already in use")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update organization")
	}
	h.recordOrganizationAudit(c, access, "organization_updated", "organization", access.Org.ID, "", access.Org, updated)
	return c.JSON(fiber.Map{"organization": updated})
}

func (h *Handler) listOrganizationWorkspaceMembers(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c)
	if !ok {
		return nil
	}
	members, err := h.queries.ListOrganizationMembers(c.Context(), access.Org.ID)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load members")
	}
	invitations, err := h.queries.ListOrganizationInvitations(c.Context(), access.Org.ID)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load invitations")
	}
	return c.JSON(fiber.Map{"members": members, "invitations": invitations})
}

func (h *Handler) updateOrganizationWorkspaceMember(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner")
	if !ok {
		return nil
	}
	var request organizationRoleRequest
	if err := c.Bind().Body(&request); err != nil ||
		!validOrganizationMemberRole(request.Role) {
		return jsonError(c, fiber.StatusBadRequest, "Role must be admin or member")
	}
	target, err := h.queries.AdminGetOrganizationMember(c.Context(), db.AdminGetOrganizationMemberParams{
		OrganizationID: access.Org.ID, UserID: c.Params("userId"),
	})
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "Organization member not found")
	}
	if target.Role == "owner" {
		return jsonError(c, fiber.StatusBadRequest, "Transfer ownership before changing the owner")
	}
	updated, err := h.queries.UpdateOrganizationMemberRole(c.Context(), db.UpdateOrganizationMemberRoleParams{
		OrganizationID: access.Org.ID, UserID: c.Params("userId"), Role: request.Role,
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update member")
	}
	h.recordOrganizationAudit(c, access, "organization_member_role_updated", "user", c.Params("userId"), "", target, updated)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) deleteOrganizationWorkspaceMember(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner", "admin")
	if !ok {
		return nil
	}
	target, err := h.queries.AdminGetOrganizationMember(c.Context(), db.AdminGetOrganizationMemberParams{
		OrganizationID: access.Org.ID, UserID: c.Params("userId"),
	})
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "Organization member not found")
	}
	if target.Role == "owner" || (access.Org.Role == "admin" && target.Role != "member") {
		return jsonError(c, fiber.StatusForbidden, "You cannot remove this member")
	}
	tx, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to remove member")
	}
	defer tx.Rollback(c.Context())
	queries := h.queries.WithTx(tx)
	if err := queries.DeleteOrganizationMemberTeams(c.Context(), db.DeleteOrganizationMemberTeamsParams{
		OrganizationID: access.Org.ID, UserID: c.Params("userId"),
	}); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to remove member")
	}
	removed, err := queries.DeleteOrganizationMember(c.Context(), db.DeleteOrganizationMemberParams{
		OrganizationID: access.Org.ID, UserID: c.Params("userId"),
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to remove member")
	}
	if err := queries.ClearOrganizationFromUserSessions(c.Context(), db.ClearOrganizationFromUserSessionsParams{
		UserID: c.Params("userId"), ActiveOrganizationID: textValue(access.Org.ID),
	}); err != nil || tx.Commit(c.Context()) != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to remove member")
	}
	h.recordOrganizationAudit(c, access, "organization_member_removed", "user", c.Params("userId"), "", removed, nil)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) inviteOrganizationWorkspaceMember(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner", "admin")
	if !ok {
		return nil
	}
	var request organizationInvitationRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	request.Email = strings.ToLower(strings.TrimSpace(request.Email))
	request.Role = strings.ToLower(strings.TrimSpace(request.Role))
	if !validEmail(request.Email) || !validOrganizationMemberRole(request.Role) {
		return jsonError(c, fiber.StatusBadRequest, "Enter a valid email and role")
	}
	if access.Org.Role == "admin" && request.Role != "member" {
		return jsonError(c, fiber.StatusForbidden, "Organization admins can only invite members")
	}
	if h.emailSender == nil {
		return jsonError(c, fiber.StatusServiceUnavailable, "Email delivery is not configured")
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
	if user, lookupErr := h.queries.GetCredentialUserByEmail(c.Context(), request.Email); lookupErr == nil {
		invitedUserID = textValue(user.ID)
	}
	tx, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to send invitation")
	}
	defer tx.Rollback(c.Context())
	queries := h.queries.WithTx(tx)
	if err := queries.AdminDeletePendingOrganizationInvitations(c.Context(), db.AdminDeletePendingOrganizationInvitationsParams{
		OrganizationID: access.Org.ID, Email: request.Email,
	}); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to send invitation")
	}
	invitation, err := queries.AdminCreateOrganizationInvitation(c.Context(), db.AdminCreateOrganizationInvitationParams{
		ID: invitationID, OrganizationID: access.Org.ID, Email: request.Email,
		Role: textValue(request.Role), ExpiresAt: timestampValue(time.Now().UTC().Add(7 * 24 * time.Hour)),
		InviterID: access.Current.UserID, Token: textValue(tokenHash), InvitedUserID: invitedUserID,
	})
	if err != nil || tx.Commit(c.Context()) != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to send invitation")
	}
	invitationURL := fmt.Sprintf("%s/accept-invitation?token=%s", h.appURL, url.QueryEscape(rawToken))
	if err := h.emailSender.SendOrganizationInvitation(c.Context(), request.Email, access.Org.Name, invitationURL); err != nil {
		_, _ = h.queries.AdminCancelOrganizationInvitation(context.Background(), db.AdminCancelOrganizationInvitationParams{
			ID: invitationID, OrganizationID: access.Org.ID,
		})
		return jsonError(c, fiber.StatusBadGateway, "Unable to send invitation")
	}
	h.recordOrganizationAudit(c, access, "organization_invitation_sent", "invitation", invitationID, "", nil, invitation)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"invitation": invitation})
}

func (h *Handler) cancelOrganizationWorkspaceInvitation(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner", "admin")
	if !ok {
		return nil
	}
	cancelled, err := h.queries.AdminCancelOrganizationInvitation(c.Context(), db.AdminCancelOrganizationInvitationParams{
		ID: c.Params("invitationId"), OrganizationID: access.Org.ID,
	})
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "Pending invitation not found")
	}
	h.recordOrganizationAudit(c, access, "organization_invitation_cancelled", "invitation", cancelled, "", fiber.Map{"id": cancelled}, nil)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) listOrganizationWorkspaceTeams(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c)
	if !ok {
		return nil
	}
	teams, err := h.queries.ListOrganizationTeams(c.Context(), db.ListOrganizationTeamsParams{
		OrganizationID: access.Org.ID, IncludeArchived: c.Query("includeArchived") == "true",
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load teams")
	}
	return c.JSON(fiber.Map{"teams": teams})
}

func (h *Handler) createOrganizationWorkspaceTeam(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner", "admin")
	if !ok {
		return nil
	}
	var request organizationTeamRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	request.Name = strings.TrimSpace(request.Name)
	if request.Name == "" || len(request.Name) > 100 {
		return jsonError(c, fiber.StatusBadRequest, "Team name is required")
	}
	if request.LeadUserID != "" && !h.isOrganizationMember(c, access.Org.ID, request.LeadUserID) {
		return jsonError(c, fiber.StatusBadRequest, "Team lead must be an organization member")
	}
	id, _ := randomValue(18)
	team, err := h.queries.CreateOrganizationTeam(c.Context(), db.CreateOrganizationTeamParams{
		ID: id, Name: request.Name, Description: optionalText(request.Description),
		OrganizationID: access.Org.ID, LeadUserID: optionalText(request.LeadUserID),
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to create team")
	}
	h.recordOrganizationAudit(c, access, "organization_team_created", "team", team.ID, "", nil, team)
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"team": team})
}

func (h *Handler) updateOrganizationWorkspaceTeam(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner", "admin")
	if !ok {
		return nil
	}
	var request organizationTeamRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	request.Name = strings.TrimSpace(request.Name)
	if request.Name == "" || (request.LeadUserID != "" && !h.isOrganizationMember(c, access.Org.ID, request.LeadUserID)) {
		return jsonError(c, fiber.StatusBadRequest, "Enter a valid team name and lead")
	}
	before, err := h.queries.GetOrganizationTeam(c.Context(), db.GetOrganizationTeamParams{
		ID: c.Params("teamId"), OrganizationID: access.Org.ID,
	})
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "Team not found")
	}
	team, err := h.queries.UpdateOrganizationTeam(c.Context(), db.UpdateOrganizationTeamParams{
		ID: before.ID, OrganizationID: access.Org.ID, Name: request.Name,
		Description: optionalText(request.Description), LeadUserID: optionalText(request.LeadUserID),
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to update team")
	}
	h.recordOrganizationAudit(c, access, "organization_team_updated", "team", team.ID, "", before, team)
	return c.JSON(fiber.Map{"team": team})
}

func (h *Handler) archiveOrganizationWorkspaceTeam(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner", "admin")
	if !ok {
		return nil
	}
	var request organizationArchiveTeamRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	team, err := h.queries.SetOrganizationTeamArchived(c.Context(), db.SetOrganizationTeamArchivedParams{
		Archived: request.Archived, ID: c.Params("teamId"), OrganizationID: access.Org.ID,
	})
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "Team not found")
	}
	event := "organization_team_archived"
	if !request.Archived {
		event = "organization_team_restored"
	}
	h.recordOrganizationAudit(c, access, event, "team", team.ID, "", nil, team)
	return c.JSON(fiber.Map{"team": team})
}

func (h *Handler) deleteOrganizationWorkspaceTeam(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner")
	if !ok {
		return nil
	}
	team, err := h.queries.DeleteOrganizationTeam(c.Context(), db.DeleteOrganizationTeamParams{
		ID: c.Params("teamId"), OrganizationID: access.Org.ID,
	})
	if err != nil {
		return jsonError(c, fiber.StatusNotFound, "Team not found")
	}
	h.recordOrganizationAudit(c, access, "organization_team_deleted", "team", team.ID, "", team, nil)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) listOrganizationWorkspaceTeamMembers(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c)
	if !ok {
		return nil
	}
	if _, err := h.queries.GetOrganizationTeam(c.Context(), db.GetOrganizationTeamParams{
		ID: c.Params("teamId"), OrganizationID: access.Org.ID,
	}); err != nil {
		return jsonError(c, fiber.StatusNotFound, "Team not found")
	}
	members, err := h.queries.ListOrganizationTeamMembers(c.Context(), db.ListOrganizationTeamMembersParams{
		OrganizationID: access.Org.ID, TeamID: c.Params("teamId"),
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load team members")
	}
	return c.JSON(fiber.Map{"members": members})
}

func (h *Handler) addOrganizationWorkspaceTeamMember(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner", "admin")
	if !ok {
		return nil
	}
	var request organizationTeamMemberRequest
	if err := c.Bind().Body(&request); err != nil || request.UserID == "" {
		return jsonError(c, fiber.StatusBadRequest, "User is required")
	}
	id, _ := randomValue(18)
	count, err := h.queries.AddOrganizationTeamMember(c.Context(), db.AddOrganizationTeamMemberParams{
		ID: id, TeamID: c.Params("teamId"), UserID: request.UserID, OrganizationID: access.Org.ID,
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to add team member")
	}
	if count == 0 {
		return jsonError(c, fiber.StatusBadRequest, "User must be an organization member")
	}
	h.recordOrganizationAudit(c, access, "organization_team_member_added", "team", c.Params("teamId"), "", nil, request)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) deleteOrganizationWorkspaceTeamMember(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner", "admin")
	if !ok {
		return nil
	}
	count, err := h.queries.DeleteOrganizationTeamMember(c.Context(), db.DeleteOrganizationTeamMemberParams{
		TeamID: c.Params("teamId"), OrganizationID: access.Org.ID, UserID: c.Params("userId"),
	})
	if err != nil || count == 0 {
		return jsonError(c, fiber.StatusNotFound, "Team member not found")
	}
	h.recordOrganizationAudit(c, access, "organization_team_member_removed", "team", c.Params("teamId"), "", fiber.Map{"userId": c.Params("userId")}, nil)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) transferOrganizationWorkspaceOwnership(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner")
	if !ok {
		return nil
	}
	var request transferOwnershipRequest
	if err := c.Bind().Body(&request); err != nil || request.UserID == access.Current.UserID ||
		strings.TrimSpace(request.Reason) == "" {
		return jsonError(c, fiber.StatusBadRequest, "Select another member and provide a reason")
	}
	target, err := h.queries.AdminGetOrganizationMember(c.Context(), db.AdminGetOrganizationMemberParams{
		OrganizationID: access.Org.ID, UserID: request.UserID,
	})
	if err != nil {
		return jsonError(c, fiber.StatusBadRequest, "New owner must be an organization member")
	}
	tx, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to transfer ownership")
	}
	defer tx.Rollback(c.Context())
	if err := h.queries.WithTx(tx).TransferOrganizationOwnership(c.Context(), db.TransferOrganizationOwnershipParams{
		NewOwnerID: request.UserID, OrganizationID: access.Org.ID,
	}); err != nil || tx.Commit(c.Context()) != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to transfer ownership")
	}
	h.recordOrganizationAudit(c, access, "organization_ownership_transferred", "user", request.UserID, request.Reason, target, fiber.Map{"role": "owner"})
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) leaveOrganizationWorkspace(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c)
	if !ok {
		return nil
	}
	if access.Org.Role == "owner" {
		return jsonError(c, fiber.StatusBadRequest, "Transfer ownership before leaving the organization")
	}
	tx, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to leave organization")
	}
	defer tx.Rollback(c.Context())
	queries := h.queries.WithTx(tx)
	if err := queries.DeleteOrganizationMemberTeams(c.Context(), db.DeleteOrganizationMemberTeamsParams{
		OrganizationID: access.Org.ID, UserID: access.Current.UserID,
	}); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to leave organization")
	}
	removed, err := queries.DeleteOrganizationMember(c.Context(), db.DeleteOrganizationMemberParams{
		OrganizationID: access.Org.ID, UserID: access.Current.UserID,
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to leave organization")
	}
	if err := queries.ClearOrganizationFromUserSessions(c.Context(), db.ClearOrganizationFromUserSessionsParams{
		UserID: access.Current.UserID, ActiveOrganizationID: textValue(access.Org.ID),
	}); err != nil || tx.Commit(c.Context()) != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to leave organization")
	}
	h.recordOrganizationAudit(c, access, "organization_member_left", "user", access.Current.UserID, "", removed, nil)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) listOrganizationWorkspaceAudit(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner")
	if !ok {
		return nil
	}
	page, pageSize := adminPagination(c)
	events, err := h.queries.ListOrganizationAuditEvents(c.Context(), db.ListOrganizationAuditEventsParams{
		OrganizationID: textValue(access.Org.ID), Limit: int32(pageSize),
		Offset: int32((page - 1) * pageSize),
	})
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load audit events")
	}
	total, err := h.queries.CountOrganizationAuditEvents(c.Context(), textValue(access.Org.ID))
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load audit events")
	}
	return c.JSON(fiber.Map{"events": events, "pagination": fiber.Map{
		"page": page, "pageSize": pageSize, "total": total,
	}})
}

func (h *Handler) isOrganizationMember(c fiber.Ctx, organizationID, userID string) bool {
	_, err := h.queries.AdminGetOrganizationMember(c.Context(), db.AdminGetOrganizationMemberParams{
		OrganizationID: organizationID, UserID: userID,
	})
	return err == nil
}

func (h *Handler) recordOrganizationAudit(
	c fiber.Ctx,
	access organizationAccess,
	eventType, targetType, targetID, reason string,
	before, after any,
) {
	id, err := randomValue(18)
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
	_ = h.queries.CreateOrganizationAuditEvent(c.Context(), db.CreateOrganizationAuditEventParams{
		ID: id, UserID: access.Current.UserID, EventType: eventType,
		IpAddress: textValue(c.IP()), UserAgent: textValue(c.Get("User-Agent")),
		TargetType: optionalText(targetType), TargetID: optionalText(targetID),
		Reason: optionalText(reason), BeforeState: beforeJSON, AfterState: afterJSON,
		OrganizationID: textValue(access.Org.ID),
	})
}

func optionalText(value string) pgtype.Text {
	value = strings.TrimSpace(value)
	if value == "" {
		return pgtype.Text{}
	}
	return textValue(value)
}
