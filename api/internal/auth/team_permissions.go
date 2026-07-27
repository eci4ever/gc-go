package auth

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"

	"gc-go/api/internal/db"
)

const (
	permissionTeamRead     = "team.read"
	permissionTeamSettings = "team.settings.update"
	permissionTeamMembers  = "team.members.manage"
	permissionTeamActivity = "team.activity.read"
	permissionTeamArchive  = "team.archive"
)

var teamPermissionCatalog = []organizationPermission{
	{permissionTeamRead, "View team", "View this team and its members.", "Team"},
	{permissionTeamSettings, "Update team", "Edit this team's name, description, and lead.", "Team"},
	{permissionTeamMembers, "Manage members", "Add, remove, and assign roles to this team's members.", "Members"},
	{permissionTeamActivity, "View activity", "Review this team's activity history.", "Security"},
	{permissionTeamArchive, "Archive team", "Archive and restore this team.", "Lifecycle"},
}

var organizationToTeamPermission = map[string]string{
	permissionTeamRead:     permissionTeamsRead,
	permissionTeamSettings: permissionTeamsUpdate,
	permissionTeamMembers:  permissionTeamMembersManage,
	permissionTeamActivity: permissionAuditRead,
	permissionTeamArchive:  permissionTeamsUpdate,
}

func validTeamPermissionKeys(keys []string) ([]string, bool) {
	available := make(map[string]struct{}, len(teamPermissionCatalog))
	for _, permission := range teamPermissionCatalog {
		available[permission.Key] = struct{}{}
	}
	unique := make([]string, 0, len(keys))
	seen := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if _, ok := available[key]; !ok {
			return nil, false
		}
		if _, exists := seen[key]; !exists {
			seen[key] = struct{}{}
			unique = append(unique, key)
		}
	}
	return unique, true
}

func containsPermission(keys []string, requested string) bool {
	for _, key := range keys {
		if key == requested {
			return true
		}
	}
	return false
}

func (h *Handler) teamPermissionsForAccess(
	c fiber.Ctx,
	access organizationAccess,
	teamID string,
) ([]string, error) {
	organizationPermissions, err := h.permissionsForMembership(
		c, access.Org, access.Current.UserID,
	)
	if err != nil {
		return nil, err
	}
	teamPermissions, err := h.queries.ListMemberTeamPermissions(
		c.Context(),
		db.ListMemberTeamPermissionsParams{
			TeamID: teamID, UserID: access.Current.UserID,
			OrganizationID: access.Org.ID,
		},
	)
	if err != nil {
		return nil, err
	}
	granted := permissionSet(teamPermissions...)
	assigned, err := h.queries.CanAccessOrganizationTeam(
		c.Context(),
		db.CanAccessOrganizationTeamParams{
			UserID: access.Current.UserID, TeamID: teamID,
			OrganizationID: access.Org.ID,
		},
	)
	if err != nil {
		return nil, err
	}
	if assigned {
		granted[permissionTeamRead] = struct{}{}
		granted[permissionTeamActivity] = struct{}{}
	}
	for teamPermission, organizationPermission := range organizationToTeamPermission {
		if containsPermission(organizationPermissions, organizationPermission) {
			granted[teamPermission] = struct{}{}
		}
	}
	result := make([]string, 0, len(granted))
	for _, permission := range teamPermissionCatalog {
		if _, ok := granted[permission.Key]; ok {
			result = append(result, permission.Key)
		}
	}
	return result, nil
}

func (h *Handler) teamPermissionAccess(
	c fiber.Ctx,
	permission string,
) (organizationAccess, bool) {
	access, ok := h.organizationAccess(c)
	if !ok {
		return organizationAccess{}, false
	}
	if _, err := h.queries.GetOrganizationTeam(c.Context(), db.GetOrganizationTeamParams{
		ID: c.Params("teamId"), OrganizationID: access.Org.ID,
	}); errors.Is(err, pgx.ErrNoRows) {
		organizationID, lookupErr := h.queries.GetTeamOrganizationID(
			c.Context(), c.Params("teamId"),
		)
		if lookupErr == nil && organizationID != access.Org.ID {
			_ = jsonError(c, fiber.StatusForbidden, "This team is not available to your account")
		} else {
			_ = jsonError(c, fiber.StatusNotFound, "Team not found")
		}
		return organizationAccess{}, false
	} else if err != nil {
		_ = jsonError(c, fiber.StatusInternalServerError, "Unable to verify team permission")
		return organizationAccess{}, false
	}
	permissions, err := h.teamPermissionsForAccess(c, access, c.Params("teamId"))
	if err != nil {
		_ = jsonError(c, fiber.StatusInternalServerError, "Unable to verify team permission")
		return organizationAccess{}, false
	}
	if containsPermission(permissions, permission) {
		return access, true
	}
	_ = jsonError(c, fiber.StatusForbidden, "You do not have permission for this team action")
	return organizationAccess{}, false
}

func (h *Handler) getTeamAccess(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c)
	if !ok {
		return nil
	}
	if _, err := h.queries.GetOrganizationTeam(c.Context(), db.GetOrganizationTeamParams{
		ID: c.Params("teamId"), OrganizationID: access.Org.ID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return jsonError(c, fiber.StatusNotFound, "Team not found")
	} else if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load team access")
	}
	permissions, err := h.teamPermissionsForAccess(c, access, c.Params("teamId"))
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load team access")
	}
	return c.JSON(fiber.Map{"permissions": permissions})
}

type teamRoleRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

type teamMemberRoleRequest struct {
	RoleID string `json:"roleId"`
}

func (h *Handler) listTeamRoles(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c)
	if !ok {
		return nil
	}
	roles, err := h.queries.ListTeamRoles(c.Context(), access.Org.ID)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load team roles")
	}
	return c.JSON(fiber.Map{"permissions": teamPermissionCatalog, "roles": roles})
}

func (h *Handler) createTeamRole(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner")
	if !ok {
		return nil
	}
	var request teamRoleRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	return h.saveTeamRole(c, access, "", request)
}

func (h *Handler) updateTeamRole(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner")
	if !ok {
		return nil
	}
	var request teamRoleRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	return h.saveTeamRole(c, access, c.Params("roleId"), request)
}

func (h *Handler) saveTeamRole(
	c fiber.Ctx,
	access organizationAccess,
	roleID string,
	request teamRoleRequest,
) error {
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	permissions, valid := validTeamPermissionKeys(request.Permissions)
	if request.Name == "" || len(request.Name) > 60 || len(request.Description) > 240 || !valid {
		return jsonError(c, fiber.StatusBadRequest, "Enter a valid team role and permissions")
	}
	tx, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to save team role")
	}
	defer tx.Rollback(c.Context())
	queries := h.queries.WithTx(tx)
	var before any
	var role db.TeamRole
	if roleID == "" {
		roleID, err = randomValue(18)
		if err == nil {
			role, err = queries.CreateTeamRole(c.Context(), db.CreateTeamRoleParams{
				ID: roleID, OrganizationID: access.Org.ID, Name: request.Name,
				Description: request.Description, CreatedBy: access.Current.UserID,
			})
		}
	} else {
		existing, lookupErr := queries.GetTeamRole(c.Context(), db.GetTeamRoleParams{
			ID: roleID, OrganizationID: access.Org.ID,
		})
		if lookupErr != nil {
			return jsonError(c, fiber.StatusNotFound, "Team role not found")
		}
		before = existing
		role, err = queries.UpdateTeamRole(c.Context(), db.UpdateTeamRoleParams{
			ID: roleID, OrganizationID: access.Org.ID,
			Name: request.Name, Description: request.Description,
		})
	}
	if err != nil {
		if isUniqueViolation(err) {
			return jsonError(c, fiber.StatusConflict, "A team role with this name already exists")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to save team role")
	}
	if err := queries.ClearTeamRolePermissions(c.Context(), roleID); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to save team role")
	}
	for _, key := range permissions {
		if err := queries.AddTeamRolePermission(c.Context(), db.AddTeamRolePermissionParams{
			RoleID: roleID, PermissionKey: key,
		}); err != nil {
			return jsonError(c, fiber.StatusInternalServerError, "Unable to save team role")
		}
	}
	if err := tx.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to save team role")
	}
	event := "team_role_created"
	status := fiber.StatusCreated
	if before != nil {
		event = "team_role_updated"
		status = fiber.StatusOK
	}
	after := fiber.Map{"role": role, "permissions": permissions}
	h.recordOrganizationAudit(c, access, event, "team_role", role.ID, "", before, after)
	return c.Status(status).JSON(after)
}

func (h *Handler) deleteTeamRole(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner")
	if !ok {
		return nil
	}
	role, err := h.queries.GetTeamRole(c.Context(), db.GetTeamRoleParams{
		ID: c.Params("roleId"), OrganizationID: access.Org.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return jsonError(c, fiber.StatusNotFound, "Team role not found")
	}
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to delete team role")
	}
	changed, err := h.queries.DeleteTeamRole(c.Context(), db.DeleteTeamRoleParams{
		ID: role.ID, OrganizationID: access.Org.ID,
	})
	if err != nil || changed == 0 {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to delete team role")
	}
	h.recordOrganizationAudit(c, access, "team_role_deleted", "team_role", role.ID, "", role, nil)
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *Handler) assignTeamMemberRole(c fiber.Ctx) error {
	access, ok := h.teamPermissionAccess(c, permissionTeamMembers)
	if !ok {
		return nil
	}
	var request teamMemberRoleRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	userID := c.Params("userId")
	if request.RoleID == "" {
		changed, err := h.queries.ClearTeamMemberRole(c.Context(), db.ClearTeamMemberRoleParams{
			TeamID: c.Params("teamId"), UserID: userID, OrganizationID: access.Org.ID,
		})
		if err != nil {
			return jsonError(c, fiber.StatusInternalServerError, "Unable to clear team role")
		}
		if changed == 0 {
			return jsonError(c, fiber.StatusNotFound, "Team role assignment not found")
		}
		h.recordOrganizationAudit(c, access, "team_member_role_cleared", "team", c.Params("teamId"), "", fiber.Map{"userId": userID}, nil)
		return c.SendStatus(fiber.StatusNoContent)
	}
	rolePermissions, err := h.queries.ListTeamRolePermissionKeys(
		c.Context(),
		db.ListTeamRolePermissionKeysParams{ID: request.RoleID, OrganizationID: access.Org.ID},
	)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to validate team role")
	}
	actorTeamPermissions, err := h.teamPermissionsForAccess(c, access, c.Params("teamId"))
	if err != nil || !containsEveryPermission(actorTeamPermissions, rolePermissions) {
		return jsonError(c, fiber.StatusForbidden, "You cannot assign a team role with permissions you do not have")
	}
	assignment, err := h.queries.AssignTeamMemberRole(c.Context(), db.AssignTeamMemberRoleParams{
		TeamID: c.Params("teamId"), UserID: userID, RoleID: request.RoleID,
		AssignedBy: access.Current.UserID, OrganizationID: access.Org.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return jsonError(c, fiber.StatusBadRequest, "Select a valid team member and role")
	}
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to assign team role")
	}
	h.recordOrganizationAudit(c, access, "team_member_role_assigned", "team", c.Params("teamId"), "", nil, assignment)
	return c.SendStatus(fiber.StatusNoContent)
}
