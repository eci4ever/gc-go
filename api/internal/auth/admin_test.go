package auth

import "testing"

func TestOrganizationSlug(t *testing.T) {
	t.Parallel()

	tests := map[string]string{
		"simple name":        "acme-company",
		"repeated spacing":   "acme-company",
		"punctuation":        "acme-company",
		"empty ASCII result": "organization",
	}
	inputs := map[string]string{
		"simple name":        "Acme Company",
		"repeated spacing":   "  Acme   Company  ",
		"punctuation":        "Acme & Company!",
		"empty ASCII result": "你好",
	}

	for name, want := range tests {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if got := organizationSlug(inputs[name]); got != want {
				t.Fatalf("organizationSlug() = %q, want %q", got, want)
			}
		})
	}
}
