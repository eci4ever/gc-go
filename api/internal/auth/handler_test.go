package auth

import (
	"strings"
	"testing"
)

func TestValidEmail(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		value string
		valid bool
	}{
		{name: "valid", value: "person@example.com", valid: true},
		{name: "invalid", value: "not-an-email", valid: false},
		{name: "display name rejected", value: "Person <person@example.com>", valid: false},
	}

	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if result := validEmail(test.value); result != test.valid {
				t.Fatalf("validEmail(%q) = %v, want %v", test.value, result, test.valid)
			}
		})
	}
}

func TestContainsOrganizationRole(t *testing.T) {
	if !containsRole("owner", []string{"owner", "admin"}) {
		t.Fatal("owner should match an owner/admin permission set")
	}
	if containsRole("member", []string{"owner", "admin"}) {
		t.Fatal("member should not match an owner/admin permission set")
	}
}

func TestValidPermissionKeys(t *testing.T) {
	keys, ok := validPermissionKeys([]string{
		permissionTeamsCreate,
		permissionMembersRead,
		permissionTeamsCreate,
	})
	if !ok {
		t.Fatal("known permission keys were rejected")
	}
	if len(keys) != 2 || keys[0] != permissionTeamsCreate || keys[1] != permissionMembersRead {
		t.Fatalf("permission keys = %#v, want unique keys in request order", keys)
	}
	if _, ok := validPermissionKeys([]string{"system.delete_everything"}); ok {
		t.Fatal("unknown permission key was accepted")
	}
}

func TestContainsEveryPermission(t *testing.T) {
	if !containsEveryPermission(
		[]string{permissionMembersRead, permissionTeamsCreate},
		[]string{permissionTeamsCreate},
	) {
		t.Fatal("permission subset was rejected")
	}
	if containsEveryPermission(
		[]string{permissionMembersRead},
		[]string{permissionTeamsCreate},
	) {
		t.Fatal("permission escalation was accepted")
	}
}

func TestSessionTokenIsHashed(t *testing.T) {
	t.Parallel()

	raw, hash, err := newSessionToken()
	if err != nil {
		t.Fatalf("newSessionToken() error = %v", err)
	}
	if raw == "" || hash == "" {
		t.Fatal("newSessionToken() returned an empty value")
	}
	if raw == hash || strings.Contains(hash, raw) {
		t.Fatal("stored session token contains the raw cookie token")
	}
	if hash != hashToken(raw) {
		t.Fatal("stored token hash does not match the cookie token")
	}
}

func TestValidImageURL(t *testing.T) {
	t.Parallel()

	tests := map[string]bool{
		"https://example.com/avatar.jpg": true,
		"http://localhost/avatar.png":    true,
		"":                               false,
		"javascript:alert(1)":            false,
		"/relative/avatar.png":           false,
	}

	for value, expected := range tests {
		if actual := validImageURL(value); actual != expected {
			t.Errorf("validImageURL(%q) = %t, want %t", value, actual, expected)
		}
	}
}
