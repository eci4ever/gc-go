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
