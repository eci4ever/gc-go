package auth

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5"

	"gc-go/api/internal/db"
)

type organizationPermission struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Group       string `json:"group"`
}

const (
	permissionOrganizationUpdate = "organization.settings.update"
	permissionMembersRead        = "members.read"
	permissionMembersInvite      = "members.invite"
	permissionMembersRoleUpdate  = "members.role.update"
	permissionMembersRemove      = "members.remove"
	permissionTeamsRead          = "teams.read"
	permissionTeamsCreate        = "teams.create"
	permissionTeamsUpdate        = "teams.update"
	permissionTeamsDelete        = "teams.delete"
	permissionTeamMembersManage  = "teams.members.manage"
	permissionAuditRead          = "audit_log.read"
)

var organizationPermissionCatalog = []organizationPermission{
	{permissionOrganizationUpdate, "Update organization", "Edit the organization name, slug, logo, and metadata.", "Organization"},
	{permissionMembersRead, "View members", "View organization members and pending invitations.", "Members"},
	{permissionMembersInvite, "Invite members", "Send and cancel organization invitations.", "Members"},
	{permissionMembersRoleUpdate, "Manage member roles", "Change standard and custom roles assigned to members.", "Members"},
	{permissionMembersRemove, "Remove members", "Remove non-owner members from the organization.", "Members"},
	{permissionTeamsRead, "View teams", "View teams and team membership.", "Teams"},
	{permissionTeamsCreate, "Create teams", "Create new organization teams.", "Teams"},
	{permissionTeamsUpdate, "Update teams", "Edit, archive, and restore teams.", "Teams"},
	{permissionTeamsDelete, "Delete teams", "Permanently delete organization teams.", "Teams"},
	{permissionTeamMembersManage, "Manage team members", "Add and remove members from teams.", "Teams"},
	{permissionAuditRead, "View audit log", "Review organization and team activity.", "Security"},
}

var adminOrganizationPermissions = permissionSet(
	permissionMembersRead,
	permissionMembersInvite,
	permissionMembersRemove,
	permissionTeamsRead,
	permissionTeamsCreate,
	permissionTeamsUpdate,
	permissionTeamMembersManage,
)

var memberOrganizationPermissions = permissionSet(
	permissionMembersRead,
	permissionTeamsRead,
)

func permissionSet(keys ...string) map[string]struct{} {
	result := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		result[key] = struct{}{}
	}
	return result
}

func containsEveryPermission(available, requested []string) bool {
	granted := permissionSet(available...)
	for _, key := range requested {
		if _, ok := granted[key]; !ok {
			return false
		}
	}
	return true
}

func validPermissionKeys(keys []string) ([]string, bool) {
	available := make(map[string]struct{}, len(organizationPermissionCatalog))
	for _, permission := range organizationPermissionCatalog {
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

func (h *Handler) permissionsForMembership(
	c fiber.Ctx,
	membership db.GetOrganizationMembershipRow,
	userID string,
) ([]string, error) {
	if membership.Role == "owner" {
		keys := make([]string, 0, len(organizationPermissionCatalog))
		for _, permission := range organizationPermissionCatalog {
			keys = append(keys, permission.Key)
		}
		return keys, nil
	}
	base := memberOrganizationPermissions
	if membership.Role == "admin" {
		base = adminOrganizationPermissions
	}
	granted := make(map[string]struct{}, len(base))
	for key := range base {
		granted[key] = struct{}{}
	}
	if membership.CustomRoleID.Valid {
		custom, err := h.queries.ListMemberCustomPermissions(
			c.Context(),
			db.ListMemberCustomPermissionsParams{
				OrganizationID: membership.ID,
				UserID:         userID,
			},
		)
		if err != nil {
			return nil, err
		}
		for _, key := range custom {
			granted[key] = struct{}{}
		}
	}
	keys := make([]string, 0, len(granted))
	for _, permission := range organizationPermissionCatalog {
		if _, ok := granted[permission.Key]; ok {
			keys = append(keys, permission.Key)
		}
	}
	return keys, nil
}

func (h *Handler) organizationPermissionAccess(
	c fiber.Ctx,
	permission string,
) (organizationAccess, bool) {
	access, ok := h.organizationAccess(c)
	if !ok {
		return organizationAccess{}, false
	}
	permissions, err := h.permissionsForMembership(c, access.Org, access.Current.UserID)
	if err != nil {
		_ = jsonError(c, fiber.StatusInternalServerError, "Unable to verify organization permission")
		return organizationAccess{}, false
	}
	for _, granted := range permissions {
		if granted == permission {
			return access, true
		}
	}
	_ = jsonError(c, fiber.StatusForbidden, "You do not have permission for this action")
	return organizationAccess{}, false
}

type organizationCustomRoleRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Permissions []string `json:"permissions"`
}

func (h *Handler) listOrganizationRoles(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c)
	if !ok {
		return nil
	}
	roles, err := h.queries.ListOrganizationCustomRoles(c.Context(), access.Org.ID)
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to load organization roles")
	}
	return c.JSON(fiber.Map{
		"permissions": organizationPermissionCatalog,
		"roles":       roles,
	})
}

func (h *Handler) createOrganizationRole(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner")
	if !ok {
		return nil
	}
	var request organizationCustomRoleRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	return h.saveOrganizationRole(c, access, "", request)
}

func (h *Handler) updateOrganizationRole(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner")
	if !ok {
		return nil
	}
	var request organizationCustomRoleRequest
	if err := c.Bind().Body(&request); err != nil {
		return jsonError(c, fiber.StatusBadRequest, "Invalid request body")
	}
	return h.saveOrganizationRole(c, access, c.Params("roleId"), request)
}

func (h *Handler) saveOrganizationRole(
	c fiber.Ctx,
	access organizationAccess,
	roleID string,
	request organizationCustomRoleRequest,
) error {
	request.Name = strings.TrimSpace(request.Name)
	request.Description = strings.TrimSpace(request.Description)
	permissions, valid := validPermissionKeys(request.Permissions)
	if request.Name == "" || len(request.Name) > 60 || len(request.Description) > 240 || !valid {
		return jsonError(c, fiber.StatusBadRequest, "Enter a valid role name, description, and permissions")
	}
	tx, err := h.pool.Begin(c.Context())
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to save role")
	}
	defer tx.Rollback(c.Context())
	queries := h.queries.WithTx(tx)
	var before any
	var role db.OrganizationRole
	if roleID == "" {
		roleID, err = randomValue(18)
		if err == nil {
			role, err = queries.CreateOrganizationCustomRole(c.Context(), db.CreateOrganizationCustomRoleParams{
				ID: roleID, OrganizationID: access.Org.ID, Name: request.Name,
				Description: request.Description, CreatedBy: access.Current.UserID,
			})
		}
	} else {
		existing, lookupErr := queries.GetOrganizationCustomRole(
			c.Context(),
			db.GetOrganizationCustomRoleParams{ID: roleID, OrganizationID: access.Org.ID},
		)
		if lookupErr != nil {
			return jsonError(c, fiber.StatusNotFound, "Organization role not found")
		}
		before = existing
		role, err = queries.UpdateOrganizationCustomRole(c.Context(), db.UpdateOrganizationCustomRoleParams{
			ID: roleID, OrganizationID: access.Org.ID,
			Name: request.Name, Description: request.Description,
		})
	}
	if err != nil {
		if isUniqueViolation(err) {
			return jsonError(c, fiber.StatusConflict, "A role with this name already exists")
		}
		return jsonError(c, fiber.StatusInternalServerError, "Unable to save role")
	}
	if err := queries.ReplaceOrganizationRolePermissions(c.Context(), roleID); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to save role")
	}
	for _, key := range permissions {
		if err := queries.AddOrganizationRolePermission(
			c.Context(),
			db.AddOrganizationRolePermissionParams{RoleID: roleID, PermissionKey: key},
		); err != nil {
			return jsonError(c, fiber.StatusInternalServerError, "Unable to save role")
		}
	}
	if err := tx.Commit(c.Context()); err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to save role")
	}
	event := "organization_role_created"
	status := fiber.StatusCreated
	if before != nil {
		event = "organization_role_updated"
		status = fiber.StatusOK
	}
	after := fiber.Map{"role": role, "permissions": permissions}
	h.recordOrganizationAudit(c, access, event, "organization_role", role.ID, "", before, after)
	return c.Status(status).JSON(after)
}

func (h *Handler) deleteOrganizationRole(c fiber.Ctx) error {
	access, ok := h.organizationAccess(c, "owner")
	if !ok {
		return nil
	}
	role, err := h.queries.GetOrganizationCustomRole(c.Context(), db.GetOrganizationCustomRoleParams{
		ID: c.Params("roleId"), OrganizationID: access.Org.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return jsonError(c, fiber.StatusNotFound, "Organization role not found")
	}
	if err != nil {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to delete role")
	}
	changed, err := h.queries.DeleteOrganizationCustomRole(
		c.Context(),
		db.DeleteOrganizationCustomRoleParams{ID: role.ID, OrganizationID: access.Org.ID},
	)
	if err != nil || changed == 0 {
		return jsonError(c, fiber.StatusInternalServerError, "Unable to delete role")
	}
	h.recordOrganizationAudit(c, access, "organization_role_deleted", "organization_role", role.ID, "", role, nil)
	return c.SendStatus(fiber.StatusNoContent)
}
