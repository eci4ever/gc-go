package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/pquerna/otp/totp"

	"gc-go/api/internal/db"
)

func TestAuthFlowIntegration(t *testing.T) {
	if os.Getenv("AUTH_INTEGRATION") != "1" {
		t.Skip("set AUTH_INTEGRATION=1 to run against DATABASE_URL")
	}
	if err := godotenv.Load("../../../.env"); err != nil && !os.IsNotExist(err) {
		t.Fatalf("load environment: %v", err)
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is not set")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect to database: %v", err)
	}

	suffix, err := randomValue(8)
	if err != nil {
		t.Fatalf("create test email: %v", err)
	}
	email := fmt.Sprintf("auth-smoke-%s@example.com", suffix)
	managedEmail := fmt.Sprintf("managed-%s@example.com", suffix)
	managedName := "Managed Organization " + suffix
	managedSlug := ""
	t.Cleanup(func() {
		if _, err := pool.Exec(
			context.Background(),
			"DELETE FROM organizations WHERE slug = $1",
			managedSlug,
		); err != nil {
			t.Errorf("clean up test organization: %v", err)
		}
		if _, err := pool.Exec(
			context.Background(),
			"DELETE FROM users WHERE email IN ($1, $2)",
			email,
			managedEmail,
		); err != nil {
			t.Errorf("clean up test user: %v", err)
		}
		pool.Close()
	})

	app := fiber.New()
	handler := NewHandler(pool, db.New(pool), false)
	emailSender := &verificationEmailRecorder{}
	handler.ConfigureEmailVerification(emailSender, "https://example.com")
	handler.Register(app.Group("/api/auth"))
	handler.RegisterDashboard(app.Group("/api"))
	handler.RegisterAdmin(app.Group("/api/admin"))
	handler.RegisterOrganizations(app.Group("/api/organizations"))

	signupResponse := authRequest(t, app, http.MethodPost, "/api/auth/signup", map[string]string{
		"name":     "Auth Smoke Test",
		"email":    email,
		"password": "correct-horse-battery-staple",
	}, nil)
	if signupResponse.StatusCode != http.StatusCreated {
		t.Fatalf("signup status = %d, want %d", signupResponse.StatusCode, http.StatusCreated)
	}
	var signupBody struct {
		Session sessionResponse `json:"session"`
		User    userResponse    `json:"user"`
	}
	decodeResponse(t, signupResponse, &signupBody)
	if signupBody.User.Role != "user" {
		t.Fatalf("signup role = %q, want user", signupBody.User.Role)
	}
	if signupBody.Session.ID == "" ||
		signupBody.Session.UserID != signupBody.User.ID {
		t.Fatal("signup did not return its session")
	}
	cookies := signupResponse.Cookies()
	if len(cookies) == 0 {
		t.Fatal("signup did not set a session cookie")
	}

	nonAdminResponse := authRequest(
		t,
		app,
		http.MethodGet,
		"/api/admin/users",
		nil,
		cookies[0],
	)
	if nonAdminResponse.StatusCode != http.StatusForbidden {
		t.Fatalf(
			"non-admin platform access status = %d, want %d",
			nonAdminResponse.StatusCode,
			http.StatusForbidden,
		)
	}
	nonAdminResponse.Body.Close()

	sessionHTTPResponse := authRequest(
		t,
		app,
		http.MethodGet,
		"/api/auth/session",
		nil,
		cookies[0],
	)
	if sessionHTTPResponse.StatusCode != http.StatusOK {
		t.Fatalf("session status = %d, want %d", sessionHTTPResponse.StatusCode, http.StatusOK)
	}
	var sessionBody struct {
		Session *sessionResponse `json:"session"`
		User    *userResponse    `json:"user"`
	}
	decodeResponse(t, sessionHTTPResponse, &sessionBody)
	if sessionBody.User == nil || !strings.EqualFold(sessionBody.User.Email, email) {
		t.Fatal("session did not return the signed-up user")
	}
	if sessionBody.Session == nil ||
		sessionBody.Session.ID != signupBody.Session.ID {
		t.Fatal("session lookup did not return the active session")
	}

	secondLoginResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/login",
		map[string]string{
			"email":    email,
			"password": "correct-horse-battery-staple",
		},
		nil,
	)
	if secondLoginResponse.StatusCode != http.StatusOK {
		t.Fatalf("second login status = %d, want %d", secondLoginResponse.StatusCode, http.StatusOK)
	}
	secondCookies := secondLoginResponse.Cookies()
	secondLoginResponse.Body.Close()
	if len(secondCookies) == 0 {
		t.Fatal("second login did not set a session cookie")
	}

	sessionsResponse := authRequest(
		t,
		app,
		http.MethodGet,
		"/api/auth/sessions",
		nil,
		cookies[0],
	)
	if sessionsResponse.StatusCode != http.StatusOK {
		t.Fatalf("sessions status = %d, want %d", sessionsResponse.StatusCode, http.StatusOK)
	}
	var sessionsBody struct {
		Sessions []managedSessionResponse `json:"sessions"`
	}
	decodeResponse(t, sessionsResponse, &sessionsBody)
	if len(sessionsBody.Sessions) != 2 {
		t.Fatalf("sessions count = %d, want 2", len(sessionsBody.Sessions))
	}
	var otherSessionID string
	for _, activeSession := range sessionsBody.Sessions {
		if !activeSession.Current {
			otherSessionID = activeSession.ID
		}
	}
	if otherSessionID == "" {
		t.Fatal("sessions list did not identify the other session")
	}

	currentRevokeResponse := authRequest(
		t,
		app,
		http.MethodDelete,
		"/api/auth/sessions/"+signupBody.Session.ID,
		nil,
		cookies[0],
	)
	if currentRevokeResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf(
			"current revoke status = %d, want %d",
			currentRevokeResponse.StatusCode,
			http.StatusBadRequest,
		)
	}
	currentRevokeResponse.Body.Close()

	revokeResponse := authRequest(
		t,
		app,
		http.MethodDelete,
		"/api/auth/sessions/"+otherSessionID,
		nil,
		cookies[0],
	)
	if revokeResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("revoke status = %d, want %d", revokeResponse.StatusCode, http.StatusNoContent)
	}
	revokeResponse.Body.Close()

	thirdLoginResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/login",
		map[string]string{
			"email":    email,
			"password": "correct-horse-battery-staple",
		},
		nil,
	)
	if thirdLoginResponse.StatusCode != http.StatusOK {
		t.Fatalf("third login status = %d, want %d", thirdLoginResponse.StatusCode, http.StatusOK)
	}
	thirdLoginResponse.Body.Close()

	bulkRevokeResponse := authRequest(
		t,
		app,
		http.MethodDelete,
		"/api/auth/sessions",
		nil,
		cookies[0],
	)
	if bulkRevokeResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"bulk revoke status = %d, want %d",
			bulkRevokeResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	bulkRevokeResponse.Body.Close()

	sessionsResponse = authRequest(
		t,
		app,
		http.MethodGet,
		"/api/auth/sessions",
		nil,
		cookies[0],
	)
	decodeResponse(t, sessionsResponse, &sessionsBody)
	if len(sessionsBody.Sessions) != 1 || !sessionsBody.Sessions[0].Current {
		t.Fatal("bulk revoke did not preserve only the current session")
	}

	dashboardResponse := authRequest(
		t,
		app,
		http.MethodGet,
		"/api/dashboard",
		nil,
		cookies[0],
	)
	if dashboardResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"dashboard status = %d, want %d",
			dashboardResponse.StatusCode,
			http.StatusOK,
		)
	}
	var dashboardBody struct {
		SecurityScore  int                      `json:"securityScore"`
		ActiveSessions int32                    `json:"activeSessions"`
		SignInActivity []signInActivityResponse `json:"signInActivity"`
		RecentSessions []managedSessionResponse `json:"recentSessions"`
	}
	decodeResponse(t, dashboardResponse, &dashboardBody)
	if dashboardBody.SecurityScore != 30 ||
		dashboardBody.ActiveSessions != 1 ||
		len(dashboardBody.SignInActivity) != 14 ||
		len(dashboardBody.RecentSessions) != 1 {
		t.Fatal("dashboard summary did not return the expected security data")
	}

	if emailSender.verificationURL == "" ||
		!strings.EqualFold(emailSender.to, email) {
		t.Fatalf(
			"signup verification email = (%q, %q), want recipient %q",
			emailSender.to,
			emailSender.verificationURL,
			email,
		)
	}
	verificationURL, err := url.Parse(emailSender.verificationURL)
	if err != nil {
		t.Fatalf("parse email verification URL: %v", err)
	}
	verifyEmailResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/email-verification/verify",
		map[string]string{"token": verificationURL.Query().Get("token")},
		nil,
	)
	if verifyEmailResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"email verification status = %d, want %d",
			verifyEmailResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	verifyEmailResponse.Body.Close()

	sessionHTTPResponse = authRequest(
		t,
		app,
		http.MethodGet,
		"/api/auth/session",
		nil,
		cookies[0],
	)
	decodeResponse(t, sessionHTTPResponse, &sessionBody)
	if sessionBody.User == nil || !sessionBody.User.EmailVerified {
		t.Fatal("email verification did not update the user")
	}

	profileResponse := authRequest(
		t,
		app,
		http.MethodPut,
		"/api/auth/profile",
		map[string]string{
			"name":  "Updated Auth Test",
			"image": "https://example.com/avatar.png",
		},
		cookies[0],
	)
	if profileResponse.StatusCode != http.StatusOK {
		t.Fatalf("profile status = %d, want %d", profileResponse.StatusCode, http.StatusOK)
	}
	var profileBody struct {
		Session sessionResponse `json:"session"`
		User    userResponse    `json:"user"`
	}
	decodeResponse(t, profileResponse, &profileBody)
	if profileBody.User.Name != "Updated Auth Test" ||
		profileBody.User.Image == nil ||
		*profileBody.User.Image != "https://example.com/avatar.png" {
		t.Fatal("profile update did not return the updated name and image")
	}
	if profileBody.User.Email != signupBody.User.Email {
		t.Fatal("profile update changed the user's email")
	}

	incorrectPasswordResponse := authRequest(
		t,
		app,
		http.MethodPut,
		"/api/auth/password",
		map[string]string{
			"currentPassword": "incorrect-password",
			"newPassword":     "updated-horse-battery-staple",
		},
		cookies[0],
	)
	if incorrectPasswordResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf(
			"incorrect password status = %d, want %d",
			incorrectPasswordResponse.StatusCode,
			http.StatusBadRequest,
		)
	}
	incorrectPasswordResponse.Body.Close()

	passwordResponse := authRequest(
		t,
		app,
		http.MethodPut,
		"/api/auth/password",
		map[string]string{
			"currentPassword": "correct-horse-battery-staple",
			"newPassword":     "updated-horse-battery-staple",
		},
		cookies[0],
	)
	if passwordResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"password status = %d, want %d",
			passwordResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	passwordResponse.Body.Close()

	twoFactorSetupResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/2fa/setup",
		map[string]string{"password": "updated-horse-battery-staple"},
		cookies[0],
	)
	if twoFactorSetupResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"2fa setup status = %d, want %d",
			twoFactorSetupResponse.StatusCode,
			http.StatusOK,
		)
	}
	var twoFactorSetupBody struct {
		Secret string `json:"secret"`
		QRCode string `json:"qrCode"`
	}
	decodeResponse(t, twoFactorSetupResponse, &twoFactorSetupBody)
	if twoFactorSetupBody.Secret == "" ||
		!strings.HasPrefix(twoFactorSetupBody.QRCode, "data:image/png;base64,") {
		t.Fatal("2fa setup did not return a secret and QR code")
	}
	twoFactorCode, err := totp.GenerateCode(
		twoFactorSetupBody.Secret,
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatalf("generate 2fa code: %v", err)
	}
	twoFactorEnableResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/2fa/enable",
		map[string]string{"code": twoFactorCode},
		cookies[0],
	)
	if twoFactorEnableResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"2fa enable status = %d, want %d",
			twoFactorEnableResponse.StatusCode,
			http.StatusOK,
		)
	}
	var twoFactorEnableBody struct {
		RecoveryCodes []string `json:"recoveryCodes"`
	}
	decodeResponse(t, twoFactorEnableResponse, &twoFactorEnableBody)
	if len(twoFactorEnableBody.RecoveryCodes) != 10 {
		t.Fatalf(
			"recovery code count = %d, want 10",
			len(twoFactorEnableBody.RecoveryCodes),
		)
	}

	logoutResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/logout",
		nil,
		cookies[0],
	)
	if logoutResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("logout status = %d, want %d", logoutResponse.StatusCode, http.StatusNoContent)
	}
	logoutResponse.Body.Close()

	loginResponse := authRequest(t, app, http.MethodPost, "/api/auth/login", map[string]string{
		"email":    email,
		"password": "updated-horse-battery-staple",
	}, nil)
	if loginResponse.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d, want %d", loginResponse.StatusCode, http.StatusOK)
	}
	var loginBody struct {
		TwoFactorRequired bool   `json:"twoFactorRequired"`
		ChallengeToken    string `json:"challengeToken"`
	}
	decodeResponse(t, loginResponse, &loginBody)
	if !loginBody.TwoFactorRequired || loginBody.ChallengeToken == "" {
		t.Fatal("login did not require a two-factor challenge")
	}

	twoFactorCode, err = totp.GenerateCode(
		twoFactorSetupBody.Secret,
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatalf("generate login 2fa code: %v", err)
	}
	verifyLoginResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/2fa/verify-login",
		map[string]string{
			"challengeToken": loginBody.ChallengeToken,
			"code":           twoFactorCode,
		},
		nil,
	)
	if verifyLoginResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"2fa login status = %d, want %d",
			verifyLoginResponse.StatusCode,
			http.StatusOK,
		)
	}
	verifiedCookies := verifyLoginResponse.Cookies()
	verifyLoginResponse.Body.Close()
	if len(verifiedCookies) == 0 {
		t.Fatal("2fa login did not set a session cookie")
	}

	recoveryLogoutResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/logout",
		nil,
		verifiedCookies[0],
	)
	if recoveryLogoutResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"recovery logout status = %d, want %d",
			recoveryLogoutResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	recoveryLogoutResponse.Body.Close()

	recoveryLoginResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/login",
		map[string]string{
			"email":    email,
			"password": "updated-horse-battery-staple",
		},
		nil,
	)
	if recoveryLoginResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"recovery login status = %d, want %d",
			recoveryLoginResponse.StatusCode,
			http.StatusOK,
		)
	}
	decodeResponse(t, recoveryLoginResponse, &loginBody)
	recoveryVerifyResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/2fa/verify-login",
		map[string]string{
			"challengeToken": loginBody.ChallengeToken,
			"code":           twoFactorEnableBody.RecoveryCodes[0],
		},
		nil,
	)
	if recoveryVerifyResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"recovery code status = %d, want %d",
			recoveryVerifyResponse.StatusCode,
			http.StatusOK,
		)
	}
	recoveryVerifyResponse.Body.Close()

	unknownResetResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/forgot-password",
		map[string]string{"email": "unknown@example.com"},
		nil,
	)
	if unknownResetResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"unknown password reset status = %d, want %d",
			unknownResetResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	unknownResetResponse.Body.Close()

	forgotPasswordResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/forgot-password",
		map[string]string{"email": email},
		nil,
	)
	if forgotPasswordResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"forgot password status = %d, want %d",
			forgotPasswordResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	forgotPasswordResponse.Body.Close()
	passwordResetURL, err := url.Parse(emailSender.resetURL)
	if err != nil || passwordResetURL.Query().Get("token") == "" {
		t.Fatalf("password reset email did not contain a valid link: %v", err)
	}
	passwordResetToken := passwordResetURL.Query().Get("token")
	resetPasswordResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/reset-password",
		map[string]string{
			"token":       passwordResetToken,
			"newPassword": "reset-horse-battery-staple",
		},
		nil,
	)
	if resetPasswordResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"reset password status = %d, want %d",
			resetPasswordResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	resetPasswordResponse.Body.Close()

	replayedResetResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/reset-password",
		map[string]string{
			"token":       passwordResetToken,
			"newPassword": "another-horse-battery-staple",
		},
		nil,
	)
	if replayedResetResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf(
			"replayed password reset status = %d, want %d",
			replayedResetResponse.StatusCode,
			http.StatusBadRequest,
		)
	}
	replayedResetResponse.Body.Close()

	resetLoginResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/login",
		map[string]string{
			"email":    email,
			"password": "reset-horse-battery-staple",
		},
		nil,
	)
	if resetLoginResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"reset password login status = %d, want %d",
			resetLoginResponse.StatusCode,
			http.StatusOK,
		)
	}
	decodeResponse(t, resetLoginResponse, &loginBody)
	if !loginBody.TwoFactorRequired {
		t.Fatal("new password did not authenticate the reset account")
	}

	adminCode, err := totp.GenerateCode(
		twoFactorSetupBody.Secret,
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatalf("generate post-reset 2fa code: %v", err)
	}
	adminLoginResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/2fa/verify-login",
		map[string]string{
			"challengeToken": loginBody.ChallengeToken,
			"code":           adminCode,
		},
		nil,
	)
	if adminLoginResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"post-reset 2fa status = %d, want %d",
			adminLoginResponse.StatusCode,
			http.StatusOK,
		)
	}
	adminCookies := adminLoginResponse.Cookies()
	adminLoginResponse.Body.Close()
	if len(adminCookies) == 0 {
		t.Fatal("post-reset 2fa did not create a session")
	}
	if _, err := pool.Exec(
		context.Background(),
		"UPDATE users SET role = 'admin' WHERE id = $1",
		signupBody.User.ID,
	); err != nil {
		t.Fatalf("promote integration user: %v", err)
	}

	createManagedUserResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/admin/users",
		map[string]any{
			"name":          "Managed User",
			"email":         managedEmail,
			"image":         "",
			"password":      "managed-horse-battery-staple",
			"role":          "user",
			"emailVerified": true,
		},
		adminCookies[0],
	)
	if createManagedUserResponse.StatusCode != http.StatusCreated {
		t.Fatalf(
			"admin create user status = %d, want %d",
			createManagedUserResponse.StatusCode,
			http.StatusCreated,
		)
	}
	var managedUserBody struct {
		User userResponse `json:"user"`
	}
	decodeResponse(t, createManagedUserResponse, &managedUserBody)

	createOrganizationResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/admin/organizations",
		map[string]any{
			"name":     managedName,
			"logo":     "",
			"metadata": `{"plan":"test"}`,
			"ownerId":  signupBody.User.ID,
		},
		adminCookies[0],
	)
	if createOrganizationResponse.StatusCode != http.StatusCreated {
		t.Fatalf(
			"admin create organization status = %d, want %d",
			createOrganizationResponse.StatusCode,
			http.StatusCreated,
		)
	}
	var organizationBody struct {
		Organization db.Organization `json:"organization"`
	}
	decodeResponse(t, createOrganizationResponse, &organizationBody)
	managedSlug = organizationBody.Organization.Slug
	if !organizationSlugPattern.MatchString(managedSlug) {
		t.Fatalf("generated organization slug %q is invalid", managedSlug)
	}

	paginatedUsersResponse := authRequest(
		t,
		app,
		http.MethodGet,
		"/api/admin/users?page=1&pageSize=1&search=managed",
		nil,
		adminCookies[0],
	)
	if paginatedUsersResponse.StatusCode != http.StatusOK {
		t.Fatalf("paginated users status = %d, want %d", paginatedUsersResponse.StatusCode, http.StatusOK)
	}
	var paginatedUsersBody struct {
		Users      []adminUserResponse `json:"users"`
		Pagination struct {
			Total int32 `json:"total"`
		} `json:"pagination"`
	}
	decodeResponse(t, paginatedUsersResponse, &paginatedUsersBody)
	if len(paginatedUsersBody.Users) != 1 || paginatedUsersBody.Pagination.Total < 1 {
		t.Fatal("server-side user pagination did not return the managed user")
	}

	inviteResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/admin/organizations/"+organizationBody.Organization.ID+"/invitations",
		map[string]any{"email": managedEmail, "role": "member"},
		adminCookies[0],
	)
	if inviteResponse.StatusCode != http.StatusCreated {
		t.Fatalf("organization invite status = %d, want %d", inviteResponse.StatusCode, http.StatusCreated)
	}
	inviteResponse.Body.Close()
	invitationURL, err := url.Parse(emailSender.invitationURL)
	if err != nil || invitationURL.Query().Get("token") == "" {
		t.Fatalf("organization invitation did not contain a valid link: %v", err)
	}

	impersonateResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/admin/users/"+managedUserBody.User.ID+"/impersonate",
		map[string]any{
			"reason":          "Integration support test",
			"durationMinutes": 15,
		},
		adminCookies[0],
	)
	if impersonateResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"impersonate status = %d, want %d",
			impersonateResponse.StatusCode,
			http.StatusOK,
		)
	}
	impersonatedCookies := impersonateResponse.Cookies()
	impersonateResponse.Body.Close()
	if len(impersonatedCookies) == 0 {
		t.Fatal("impersonation did not create a session")
	}

	acceptInvitationResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/invitations/accept",
		map[string]any{"token": invitationURL.Query().Get("token")},
		impersonatedCookies[0],
	)
	if acceptInvitationResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"accept organization invitation status = %d, want %d",
			acceptInvitationResponse.StatusCode,
			http.StatusOK,
		)
	}
	acceptInvitationResponse.Body.Close()

	myOrganizationsResponse := authRequest(
		t,
		app,
		http.MethodGet,
		"/api/organizations",
		nil,
		impersonatedCookies[0],
	)
	if myOrganizationsResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"list user organizations status = %d, want %d",
			myOrganizationsResponse.StatusCode,
			http.StatusOK,
		)
	}
	var myOrganizationsBody struct {
		Organizations []db.ListUserOrganizationsRow `json:"organizations"`
	}
	decodeResponse(t, myOrganizationsResponse, &myOrganizationsBody)
	if len(myOrganizationsBody.Organizations) != 1 ||
		myOrganizationsBody.Organizations[0].Role != "member" {
		t.Fatal("accepted organization membership was not returned")
	}

	memberCreateTeamResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams",
		map[string]any{"name": "Forbidden Team"},
		impersonatedCookies[0],
	)
	if memberCreateTeamResponse.StatusCode != http.StatusForbidden {
		t.Fatalf(
			"member create team status = %d, want %d",
			memberCreateTeamResponse.StatusCode,
			http.StatusForbidden,
		)
	}
	memberCreateTeamResponse.Body.Close()

	ownerCreateTeamResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams",
		map[string]any{
			"name":        "Operations",
			"description": "Integration team",
			"leadUserId":  managedUserBody.User.ID,
		},
		adminCookies[0],
	)
	if ownerCreateTeamResponse.StatusCode != http.StatusCreated {
		t.Fatalf(
			"owner create team status = %d, want %d",
			ownerCreateTeamResponse.StatusCode,
			http.StatusCreated,
		)
	}
	var teamBody struct {
		Team db.Team `json:"team"`
	}
	decodeResponse(t, ownerCreateTeamResponse, &teamBody)

	addTeamMemberResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/members",
		map[string]any{"userId": managedUserBody.User.ID},
		adminCookies[0],
	)
	if addTeamMemberResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"add team member status = %d, want %d",
			addTeamMemberResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	addTeamMemberResponse.Body.Close()

	emptyBulkResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/members/bulk",
		map[string]any{"action": "add", "userIds": []string{}},
		adminCookies[0],
	)
	if emptyBulkResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty bulk members status = %d, want %d", emptyBulkResponse.StatusCode, http.StatusBadRequest)
	}
	emptyBulkResponse.Body.Close()

	outsiderBulkResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/members/bulk",
		map[string]any{"action": "add", "userIds": []string{"outside-user"}},
		adminCookies[0],
	)
	if outsiderBulkResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("outsider bulk members status = %d, want %d", outsiderBulkResponse.StatusCode, http.StatusBadRequest)
	}
	outsiderBulkResponse.Body.Close()

	bulkAddResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/members/bulk",
		map[string]any{
			"action":  "add",
			"userIds": []string{managedUserBody.User.ID, signupBody.User.ID, signupBody.User.ID},
		},
		adminCookies[0],
	)
	if bulkAddResponse.StatusCode != http.StatusOK {
		t.Fatalf("mixed bulk add status = %d, want %d", bulkAddResponse.StatusCode, http.StatusOK)
	}
	var bulkAddBody struct {
		RequestedCount int   `json:"requestedCount"`
		ChangedCount   int64 `json:"changedCount"`
	}
	decodeResponse(t, bulkAddResponse, &bulkAddBody)
	if bulkAddBody.RequestedCount != 2 || bulkAddBody.ChangedCount != 1 {
		t.Fatalf("mixed bulk add counts = %+v, want requested 2 changed 1", bulkAddBody)
	}

	memberBulkResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/members/bulk",
		map[string]any{"action": "remove", "userIds": []string{signupBody.User.ID}},
		impersonatedCookies[0],
	)
	if memberBulkResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("member bulk members status = %d, want %d", memberBulkResponse.StatusCode, http.StatusForbidden)
	}
	memberBulkResponse.Body.Close()

	if _, err := pool.Exec(
		context.Background(),
		"UPDATE members SET role = 'admin' WHERE organization_id = $1 AND user_id = $2",
		organizationBody.Organization.ID,
		managedUserBody.User.ID,
	); err != nil {
		t.Fatalf("promote organization admin: %v", err)
	}
	archiveTeamResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/archive",
		map[string]any{"archived": true},
		impersonatedCookies[0],
	)
	if archiveTeamResponse.StatusCode != http.StatusOK {
		t.Fatalf("archive team status = %d, want %d", archiveTeamResponse.StatusCode, http.StatusOK)
	}
	archiveTeamResponse.Body.Close()

	archivedMutationResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/members/bulk",
		map[string]any{"action": "remove", "userIds": []string{signupBody.User.ID}},
		adminCookies[0],
	)
	if archivedMutationResponse.StatusCode != http.StatusConflict {
		t.Fatalf("archived team mutation status = %d, want %d", archivedMutationResponse.StatusCode, http.StatusConflict)
	}
	archivedMutationResponse.Body.Close()

	archivedUpdateResponse := authRequest(
		t,
		app,
		http.MethodPut,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID,
		map[string]any{"name": "Archived update"},
		adminCookies[0],
	)
	if archivedUpdateResponse.StatusCode != http.StatusConflict {
		t.Fatalf("archived team update status = %d, want %d", archivedUpdateResponse.StatusCode, http.StatusConflict)
	}
	archivedUpdateResponse.Body.Close()

	archivedSingleAddResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/members",
		map[string]any{"userId": managedUserBody.User.ID},
		adminCookies[0],
	)
	if archivedSingleAddResponse.StatusCode != http.StatusConflict {
		t.Fatalf("archived single member add status = %d, want %d", archivedSingleAddResponse.StatusCode, http.StatusConflict)
	}
	archivedSingleAddResponse.Body.Close()

	archivedSingleRemoveResponse := authRequest(
		t,
		app,
		http.MethodDelete,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/members/"+managedUserBody.User.ID,
		nil,
		adminCookies[0],
	)
	if archivedSingleRemoveResponse.StatusCode != http.StatusConflict {
		t.Fatalf("archived single member remove status = %d, want %d", archivedSingleRemoveResponse.StatusCode, http.StatusConflict)
	}
	archivedSingleRemoveResponse.Body.Close()

	restoreTeamResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/archive",
		map[string]any{"archived": false},
		impersonatedCookies[0],
	)
	if restoreTeamResponse.StatusCode != http.StatusOK {
		t.Fatalf("restore team status = %d, want %d", restoreTeamResponse.StatusCode, http.StatusOK)
	}
	restoreTeamResponse.Body.Close()

	adminDeleteTeamResponse := authRequest(
		t,
		app,
		http.MethodDelete,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID,
		nil,
		impersonatedCookies[0],
	)
	if adminDeleteTeamResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("organization admin delete team status = %d, want %d", adminDeleteTeamResponse.StatusCode, http.StatusForbidden)
	}
	adminDeleteTeamResponse.Body.Close()

	deleteTeamCreateResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams",
		map[string]any{"name": "Disposable"},
		adminCookies[0],
	)
	if deleteTeamCreateResponse.StatusCode != http.StatusCreated {
		t.Fatalf("create disposable team status = %d, want %d", deleteTeamCreateResponse.StatusCode, http.StatusCreated)
	}
	var disposableTeamBody struct {
		Team db.Team `json:"team"`
	}
	decodeResponse(t, deleteTeamCreateResponse, &disposableTeamBody)
	ownerDeleteTeamResponse := authRequest(
		t,
		app,
		http.MethodDelete,
		"/api/organizations/"+managedSlug+"/teams/"+disposableTeamBody.Team.ID,
		nil,
		adminCookies[0],
	)
	if ownerDeleteTeamResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("owner delete team status = %d, want %d", ownerDeleteTeamResponse.StatusCode, http.StatusNoContent)
	}
	ownerDeleteTeamResponse.Body.Close()

	scopedBulkResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/not-a-team/members/bulk",
		map[string]any{"action": "add", "userIds": []string{managedUserBody.User.ID}},
		adminCookies[0],
	)
	if scopedBulkResponse.StatusCode != http.StatusNotFound {
		t.Fatalf("scoped bulk status = %d, want %d", scopedBulkResponse.StatusCode, http.StatusNotFound)
	}
	scopedBulkResponse.Body.Close()

	organizationAuditResponse := authRequest(
		t,
		app,
		http.MethodGet,
		"/api/organizations/"+managedSlug+"/audit-events",
		nil,
		adminCookies[0],
	)
	if organizationAuditResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"organization audit status = %d, want %d",
			organizationAuditResponse.StatusCode,
			http.StatusOK,
		)
	}
	organizationAuditResponse.Body.Close()

	impersonatedAdminResponse := authRequest(
		t,
		app,
		http.MethodGet,
		"/api/admin/users",
		nil,
		impersonatedCookies[0],
	)
	if impersonatedAdminResponse.StatusCode != http.StatusForbidden {
		t.Fatalf(
			"impersonated admin access status = %d, want %d",
			impersonatedAdminResponse.StatusCode,
			http.StatusForbidden,
		)
	}
	impersonatedAdminResponse.Body.Close()

	stopImpersonationResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/impersonation/stop",
		nil,
		impersonatedCookies[0],
	)
	if stopImpersonationResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"stop impersonation status = %d, want %d",
			stopImpersonationResponse.StatusCode,
			http.StatusOK,
		)
	}
	returnedAdminCookies := stopImpersonationResponse.Cookies()
	stopImpersonationResponse.Body.Close()
	if len(returnedAdminCookies) == 0 {
		t.Fatal("stop impersonation did not restore an admin session")
	}

	adminDashboardResponse := authRequest(
		t,
		app,
		http.MethodGet,
		"/api/admin/dashboard",
		nil,
		returnedAdminCookies[0],
	)
	if adminDashboardResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"admin dashboard status = %d, want %d",
			adminDashboardResponse.StatusCode,
			http.StatusOK,
		)
	}
	adminDashboardResponse.Body.Close()

	auditResponse := authRequest(
		t,
		app,
		http.MethodGet,
		"/api/admin/audit-events?page=1&pageSize=10",
		nil,
		returnedAdminCookies[0],
	)
	if auditResponse.StatusCode != http.StatusOK {
		t.Fatalf("audit status = %d, want %d", auditResponse.StatusCode, http.StatusOK)
	}
	auditResponse.Body.Close()

	bulkBanResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/admin/users/bulk",
		map[string]any{
			"action":  "ban",
			"userIds": []string{managedUserBody.User.ID},
			"reason":  "Integration bulk test",
		},
		returnedAdminCookies[0],
	)
	if bulkBanResponse.StatusCode != http.StatusOK {
		t.Fatalf("bulk ban status = %d, want %d", bulkBanResponse.StatusCode, http.StatusOK)
	}
	bulkBanResponse.Body.Close()

	bulkUnbanResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/admin/users/bulk",
		map[string]any{
			"action":  "unban",
			"userIds": []string{managedUserBody.User.ID},
		},
		returnedAdminCookies[0],
	)
	if bulkUnbanResponse.StatusCode != http.StatusOK {
		t.Fatalf("bulk unban status = %d, want %d", bulkUnbanResponse.StatusCode, http.StatusOK)
	}
	bulkUnbanResponse.Body.Close()

	deleteOrganizationResponse := authRequest(
		t,
		app,
		http.MethodDelete,
		"/api/admin/organizations/"+organizationBody.Organization.ID,
		nil,
		returnedAdminCookies[0],
	)
	if deleteOrganizationResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"admin delete organization status = %d, want %d",
			deleteOrganizationResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	deleteOrganizationResponse.Body.Close()

	restoreOrganizationResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/admin/organizations/"+organizationBody.Organization.ID+"/restore",
		nil,
		returnedAdminCookies[0],
	)
	if restoreOrganizationResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"admin restore organization status = %d, want %d",
			restoreOrganizationResponse.StatusCode,
			http.StatusOK,
		)
	}
	restoreOrganizationResponse.Body.Close()

	deleteOrganizationResponse = authRequest(
		t,
		app,
		http.MethodDelete,
		"/api/admin/organizations/"+organizationBody.Organization.ID,
		nil,
		returnedAdminCookies[0],
	)
	if deleteOrganizationResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("second organization delete status = %d, want %d", deleteOrganizationResponse.StatusCode, http.StatusNoContent)
	}
	deleteOrganizationResponse.Body.Close()

	deleteManagedUserResponse := authRequest(
		t,
		app,
		http.MethodDelete,
		"/api/admin/users/"+managedUserBody.User.ID,
		nil,
		returnedAdminCookies[0],
	)
	if deleteManagedUserResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"admin delete user status = %d, want %d",
			deleteManagedUserResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	deleteManagedUserResponse.Body.Close()

	restoreManagedUserResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/admin/users/"+managedUserBody.User.ID+"/restore",
		nil,
		returnedAdminCookies[0],
	)
	if restoreManagedUserResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"admin restore user status = %d, want %d",
			restoreManagedUserResponse.StatusCode,
			http.StatusOK,
		)
	}
	restoreManagedUserResponse.Body.Close()
}

type verificationEmailRecorder struct {
	to              string
	verificationURL string
	resetURL        string
	invitationURL   string
}

func (r *verificationEmailRecorder) SendPasswordReset(
	_ context.Context,
	to string,
	_ string,
	resetURL string,
) error {
	r.to = to
	r.resetURL = resetURL
	return nil
}

func (r *verificationEmailRecorder) SendOrganizationInvitation(
	_ context.Context,
	_ string,
	_ string,
	invitationURL string,
) error {
	r.invitationURL = invitationURL
	return nil
}

func (r *verificationEmailRecorder) SendVerification(
	_ context.Context,
	to string,
	_ string,
	verificationURL string,
) error {
	r.to = to
	r.verificationURL = verificationURL
	return nil
}

func authRequest(
	t *testing.T,
	app *fiber.App,
	method string,
	path string,
	body any,
	cookie *http.Cookie,
) *http.Response {
	t.Helper()

	var payload []byte
	var err error
	if body != nil {
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatalf("encode request: %v", err)
		}
	}

	request := httptest.NewRequest(method, path, bytes.NewReader(payload))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		request.Header.Set("Cookie", cookie.Name+"="+cookie.Value)
	}

	response, err := app.Test(request, fiber.TestConfig{
		Timeout:       30 * time.Second,
		FailOnTimeout: true,
	})
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return response
}

func decodeResponse(t *testing.T, response *http.Response, target any) {
	t.Helper()
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}
