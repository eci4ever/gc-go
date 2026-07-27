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
	"sync"
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

	emailTo, verificationEmailURL, _, _ := emailSender.snapshot()
	if verificationEmailURL == "" ||
		!strings.EqualFold(emailTo, email) {
		t.Fatalf(
			"signup verification email = (%q, %q), want recipient %q",
			emailTo,
			verificationEmailURL,
			email,
		)
	}
	verificationURL, err := url.Parse(verificationEmailURL)
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

	notificationsResponse := authRequest(
		t,
		app,
		http.MethodGet,
		"/api/auth/notifications",
		nil,
		cookies[0],
	)
	if notificationsResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"notifications status = %d, want %d",
			notificationsResponse.StatusCode,
			http.StatusOK,
		)
	}
	var notificationsBody struct {
		Notifications []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"notifications"`
		UnreadCount int32 `json:"unreadCount"`
	}
	decodeResponse(t, notificationsResponse, &notificationsBody)
	if len(notificationsBody.Notifications) != 3 ||
		notificationsBody.UnreadCount != 3 {
		t.Fatalf(
			"notifications = %d unread = %d, want 3 and 3",
			len(notificationsBody.Notifications),
			notificationsBody.UnreadCount,
		)
	}

	readNotificationResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/notifications/"+notificationsBody.Notifications[0].ID+"/read",
		nil,
		cookies[0],
	)
	if readNotificationResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"mark notification read status = %d, want %d",
			readNotificationResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	readNotificationResponse.Body.Close()

	markAllNotificationsResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/auth/notifications/read-all",
		nil,
		cookies[0],
	)
	if markAllNotificationsResponse.StatusCode != http.StatusOK {
		t.Fatalf(
			"mark all notifications status = %d, want %d",
			markAllNotificationsResponse.StatusCode,
			http.StatusOK,
		)
	}
	var markAllNotificationsBody struct {
		Updated int64 `json:"updated"`
	}
	decodeResponse(t, markAllNotificationsResponse, &markAllNotificationsBody)
	if markAllNotificationsBody.Updated != 2 {
		t.Fatalf(
			"marked notifications = %d, want 2",
			markAllNotificationsBody.Updated,
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
	_, _, resetURL, _ := emailSender.snapshot()
	passwordResetURL, err := url.Parse(resetURL)
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
	_, _, _, recordedInvitationURL := emailSender.snapshot()
	invitationURL, err := url.Parse(recordedInvitationURL)
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

	customRoleResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/roles",
		map[string]any{
			"name":        "Team creator",
			"description": "Can create organization teams",
			"permissions": []string{permissionTeamsCreate},
		},
		adminCookies[0],
	)
	if customRoleResponse.StatusCode != http.StatusCreated {
		t.Fatalf(
			"create custom role status = %d, want %d",
			customRoleResponse.StatusCode,
			http.StatusCreated,
		)
	}
	var customRoleBody struct {
		Role db.OrganizationRole `json:"role"`
	}
	decodeResponse(t, customRoleResponse, &customRoleBody)

	assignCustomRoleResponse := authRequest(
		t,
		app,
		http.MethodPut,
		"/api/organizations/"+managedSlug+"/members/"+managedUserBody.User.ID,
		map[string]any{"customRoleId": customRoleBody.Role.ID},
		adminCookies[0],
	)
	if assignCustomRoleResponse.StatusCode != http.StatusNoContent {
		t.Fatalf(
			"assign custom role status = %d, want %d",
			assignCustomRoleResponse.StatusCode,
			http.StatusNoContent,
		)
	}
	assignCustomRoleResponse.Body.Close()

	customRoleCreateTeamResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams",
		map[string]any{"name": "Custom role team"},
		impersonatedCookies[0],
	)
	if customRoleCreateTeamResponse.StatusCode != http.StatusCreated {
		t.Fatalf(
			"custom role create team status = %d, want %d",
			customRoleCreateTeamResponse.StatusCode,
			http.StatusCreated,
		)
	}
	customRoleCreateTeamResponse.Body.Close()

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

	teamRoleResponse := authRequest(
		t,
		app,
		http.MethodPost,
		"/api/organizations/"+managedSlug+"/team-roles",
		map[string]any{
			"name":        "Team editor",
			"description": "Can edit an assigned team",
			"permissions": []string{permissionTeamSettings},
		},
		adminCookies[0],
	)
	if teamRoleResponse.StatusCode != http.StatusCreated {
		t.Fatalf("create team role status = %d, want %d", teamRoleResponse.StatusCode, http.StatusCreated)
	}
	var teamRoleBody struct {
		Role db.TeamRole `json:"role"`
	}
	decodeResponse(t, teamRoleResponse, &teamRoleBody)

	assignTeamRoleResponse := authRequest(
		t,
		app,
		http.MethodPut,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+
			"/members/"+managedUserBody.User.ID+"/role",
		map[string]any{"roleId": teamRoleBody.Role.ID},
		adminCookies[0],
	)
	if assignTeamRoleResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("assign team role status = %d, want %d", assignTeamRoleResponse.StatusCode, http.StatusNoContent)
	}
	assignTeamRoleResponse.Body.Close()

	teamRoleUpdateResponse := authRequest(
		t,
		app,
		http.MethodPut,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID,
		map[string]any{
			"name": "Operations", "description": "Updated by team permission",
			"leadUserId": managedUserBody.User.ID,
		},
		impersonatedCookies[0],
	)
	if teamRoleUpdateResponse.StatusCode != http.StatusOK {
		t.Fatalf("team role update status = %d, want %d", teamRoleUpdateResponse.StatusCode, http.StatusOK)
	}
	teamRoleUpdateResponse.Body.Close()

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

	activateTeamResponse := authRequest(
		t, app, http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/activate",
		nil, impersonatedCookies[0],
	)
	if activateTeamResponse.StatusCode != http.StatusOK {
		t.Fatalf("activate assigned team status = %d, want %d", activateTeamResponse.StatusCode, http.StatusOK)
	}
	activateTeamResponse.Body.Close()
	activeTeamSessionResponse := authRequest(
		t, app, http.MethodGet, "/api/auth/session", nil, impersonatedCookies[0],
	)
	var activeTeamSessionBody struct {
		Session sessionResponse `json:"session"`
	}
	decodeResponse(t, activeTeamSessionResponse, &activeTeamSessionBody)
	if activeTeamSessionBody.Session.ActiveTeamID == nil ||
		*activeTeamSessionBody.Session.ActiveTeamID != teamBody.Team.ID {
		t.Fatal("activated team was not returned in session metadata")
	}
	invalidTeamResponse := authRequest(
		t, app, http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/not-a-team/activate",
		nil, impersonatedCookies[0],
	)
	if invalidTeamResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("activate invalid team status = %d, want %d", invalidTeamResponse.StatusCode, http.StatusForbidden)
	}
	invalidTeamResponse.Body.Close()
	accessibleTeamsResponse := authRequest(
		t, app, http.MethodGet,
		"/api/organizations/"+managedSlug+"/accessible-teams",
		nil, impersonatedCookies[0],
	)
	if accessibleTeamsResponse.StatusCode != http.StatusOK {
		t.Fatalf("accessible teams status = %d, want %d", accessibleTeamsResponse.StatusCode, http.StatusOK)
	}
	var accessibleTeamsBody struct {
		Teams        []db.ListAccessibleOrganizationTeamsRow `json:"teams"`
		ActiveTeamID *string                                 `json:"activeTeamId"`
	}
	decodeResponse(t, accessibleTeamsResponse, &accessibleTeamsBody)
	if len(accessibleTeamsBody.Teams) != 1 || accessibleTeamsBody.ActiveTeamID == nil {
		t.Fatal("accessible teams did not include assigned active team")
	}
	assignedActivityResponse := authRequest(
		t, app, http.MethodGet,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/activity",
		nil, impersonatedCookies[0],
	)
	if assignedActivityResponse.StatusCode != http.StatusOK {
		t.Fatalf("assigned member activity status = %d, want %d", assignedActivityResponse.StatusCode, http.StatusOK)
	}
	assignedActivityResponse.Body.Close()
	ownerActivityResponse := authRequest(
		t, app, http.MethodGet,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/activity",
		nil, adminCookies[0],
	)
	if ownerActivityResponse.StatusCode != http.StatusOK {
		t.Fatalf("owner activity status = %d, want %d", ownerActivityResponse.StatusCode, http.StatusOK)
	}
	ownerActivityResponse.Body.Close()

	foreignOrgID, _ := randomValue(18)
	foreignTeamID, _ := randomValue(18)
	if _, err := pool.Exec(context.Background(),
		"INSERT INTO organizations (id, name, slug) VALUES ($1, 'Foreign Activity Org', $2)",
		foreignOrgID, "foreign-activity-"+strings.ToLower(suffix),
	); err != nil {
		t.Fatalf("seed foreign activity organization: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), "DELETE FROM organizations WHERE id = $1", foreignOrgID)
	})
	if _, err := pool.Exec(context.Background(),
		"INSERT INTO teams (id, name, organization_id) VALUES ($1, 'Foreign Activity Team', $2)",
		foreignTeamID, foreignOrgID,
	); err != nil {
		t.Fatalf("seed foreign activity team: %v", err)
	}
	foreignActivityResponse := authRequest(
		t, app, http.MethodGet,
		"/api/organizations/"+managedSlug+"/teams/"+foreignTeamID+"/activity",
		nil, adminCookies[0],
	)
	if foreignActivityResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign team activity status = %d, want %d", foreignActivityResponse.StatusCode, http.StatusForbidden)
	}
	foreignActivityResponse.Body.Close()

	removeAssignedMemberResponse := authRequest(
		t, app, http.MethodDelete,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/members/"+managedUserBody.User.ID,
		nil, adminCookies[0],
	)
	if removeAssignedMemberResponse.StatusCode != http.StatusNoContent {
		t.Fatalf("remove assigned member status = %d, want %d", removeAssignedMemberResponse.StatusCode, http.StatusNoContent)
	}
	removeAssignedMemberResponse.Body.Close()
	unassignedActivityResponse := authRequest(
		t, app, http.MethodGet,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/activity",
		nil, impersonatedCookies[0],
	)
	if unassignedActivityResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("unassigned member activity status = %d, want %d", unassignedActivityResponse.StatusCode, http.StatusForbidden)
	}
	unassignedActivityResponse.Body.Close()

	if _, err := pool.Exec(
		context.Background(),
		"UPDATE members SET role = 'admin' WHERE organization_id = $1 AND user_id = $2",
		organizationBody.Organization.ID,
		managedUserBody.User.ID,
	); err != nil {
		t.Fatalf("promote organization admin: %v", err)
	}
	adminActivityResponse := authRequest(
		t, app, http.MethodGet,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/activity",
		nil, impersonatedCookies[0],
	)
	if adminActivityResponse.StatusCode != http.StatusOK {
		t.Fatalf("organization admin activity status = %d, want %d", adminActivityResponse.StatusCode, http.StatusOK)
	}
	adminActivityResponse.Body.Close()
	adminActivateTeamResponse := authRequest(
		t, app, http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/activate",
		nil, impersonatedCookies[0],
	)
	if adminActivateTeamResponse.StatusCode != http.StatusOK {
		t.Fatalf("organization admin activate team status = %d, want %d", adminActivateTeamResponse.StatusCode, http.StatusOK)
	}
	adminActivateTeamResponse.Body.Close()
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
	archivedSessionResponse := authRequest(
		t, app, http.MethodGet, "/api/auth/session", nil, impersonatedCookies[0],
	)
	var archivedSessionBody struct {
		Session sessionResponse `json:"session"`
	}
	decodeResponse(t, archivedSessionResponse, &archivedSessionBody)
	if archivedSessionBody.Session.ActiveTeamID != nil {
		t.Fatal("archiving team did not clear active team context")
	}

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

	ownerActivateTeamResponse := authRequest(
		t, app, http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/activate",
		nil, adminCookies[0],
	)
	if ownerActivateTeamResponse.StatusCode != http.StatusOK {
		t.Fatalf("owner activate team status = %d, want %d", ownerActivateTeamResponse.StatusCode, http.StatusOK)
	}
	ownerActivateTeamResponse.Body.Close()
	removeOwnerAssignmentResponse := authRequest(
		t, app, http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/members/bulk",
		map[string]any{"action": "remove", "userIds": []string{signupBody.User.ID}},
		impersonatedCookies[0],
	)
	if removeOwnerAssignmentResponse.StatusCode != http.StatusOK {
		t.Fatalf("remove active team assignment status = %d, want %d", removeOwnerAssignmentResponse.StatusCode, http.StatusOK)
	}
	removeOwnerAssignmentResponse.Body.Close()
	removedAssignmentSessionResponse := authRequest(
		t, app, http.MethodGet, "/api/auth/session", nil, adminCookies[0],
	)
	var removedAssignmentSessionBody struct {
		Session sessionResponse `json:"session"`
	}
	decodeResponse(t, removedAssignmentSessionResponse, &removedAssignmentSessionBody)
	if removedAssignmentSessionBody.Session.ActiveTeamID != nil {
		t.Fatal("removing team assignment did not clear active team context")
	}

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
	activateDisposableResponse := authRequest(
		t, app, http.MethodPost,
		"/api/organizations/"+managedSlug+"/teams/"+disposableTeamBody.Team.ID+"/activate",
		nil, adminCookies[0],
	)
	if activateDisposableResponse.StatusCode != http.StatusOK {
		t.Fatalf("activate disposable team status = %d, want %d", activateDisposableResponse.StatusCode, http.StatusOK)
	}
	activateDisposableResponse.Body.Close()
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
	deletedTeamSessionResponse := authRequest(
		t, app, http.MethodGet, "/api/auth/session", nil, adminCookies[0],
	)
	var deletedTeamSessionBody struct {
		Session sessionResponse `json:"session"`
	}
	decodeResponse(t, deletedTeamSessionResponse, &deletedTeamSessionBody)
	if deletedTeamSessionBody.Session.ActiveTeamID != nil {
		t.Fatal("deleting team did not clear active team context")
	}

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

	teamActivityResponse := authRequest(
		t, app, http.MethodGet,
		"/api/organizations/"+managedSlug+"/teams/"+teamBody.Team.ID+"/activity?page=1&pageSize=2",
		nil, impersonatedCookies[0],
	)
	if teamActivityResponse.StatusCode != http.StatusOK {
		t.Fatalf("team activity status = %d, want %d", teamActivityResponse.StatusCode, http.StatusOK)
	}
	var teamActivityBody struct {
		Events     []db.ListTeamAuditEventsRow `json:"events"`
		Pagination struct {
			Page, PageSize int
			Total          int64
		} `json:"pagination"`
	}
	decodeResponse(t, teamActivityResponse, &teamActivityBody)
	if len(teamActivityBody.Events) != 2 || teamActivityBody.Pagination.PageSize != 2 ||
		teamActivityBody.Pagination.Total < 2 {
		t.Fatal("team activity pagination did not return scoped events")
	}
	for _, event := range teamActivityBody.Events {
		if !event.TargetID.Valid || event.TargetID.String != teamBody.Team.ID {
			t.Fatal("team activity included an event from another target")
		}
	}

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

func TestTeamInvitationIntegration(t *testing.T) {
	if os.Getenv("AUTH_INTEGRATION") != "1" {
		t.Skip("set AUTH_INTEGRATION=1 to run against DATABASE_URL")
	}
	_ = godotenv.Load("../../../.env")
	pool, err := pgxpool.New(context.Background(), os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect to database: %v", err)
	}
	defer pool.Close()

	suffix, _ := randomValue(8)
	ownerEmail := "team-owner-" + suffix + "@example.com"
	memberEmail := "team-member-" + suffix + "@example.com"
	rollbackEmail := "team-rollback-" + suffix + "@example.com"
	orgID, _ := randomValue(18)
	foreignOrgID, _ := randomValue(18)
	teamID, _ := randomValue(18)
	archivedTeamID, _ := randomValue(18)
	foreignTeamID, _ := randomValue(18)
	slug := "team-invite-" + strings.ToLower(suffix)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), "DELETE FROM organizations WHERE id IN ($1, $2)", orgID, foreignOrgID)
		_, _ = pool.Exec(context.Background(), "DELETE FROM users WHERE email IN ($1, $2, $3)", ownerEmail, memberEmail, rollbackEmail)
	})

	app := fiber.New()
	handler := NewHandler(pool, db.New(pool), false)
	emailSender := &verificationEmailRecorder{}
	handler.ConfigureEmailVerification(emailSender, "https://example.com")
	handler.Register(app.Group("/api/auth"))
	handler.RegisterOrganizations(app.Group("/api/organizations"))

	signup := func(email string) (userResponse, *http.Cookie) {
		response := authRequest(t, app, http.MethodPost, "/api/auth/signup", map[string]string{
			"name": email, "email": email, "password": "correct-horse-battery-staple",
		}, nil)
		if response.StatusCode != http.StatusCreated {
			t.Fatalf("signup %s status = %d", email, response.StatusCode)
		}
		var body struct {
			User userResponse `json:"user"`
		}
		cookies := response.Cookies()
		decodeResponse(t, response, &body)
		return body.User, cookies[0]
	}
	owner, ownerCookie := signup(ownerEmail)
	member, memberCookie := signup(memberEmail)
	rollbackUser, rollbackCookie := signup(rollbackEmail)

	if _, err := pool.Exec(context.Background(),
		"INSERT INTO organizations (id, name, slug) VALUES ($1, 'Team Invite Org', $2), ($3, 'Foreign Org', $4)",
		orgID, slug, foreignOrgID, slug+"-foreign",
	); err != nil {
		t.Fatalf("seed team invitation fixtures: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		"INSERT INTO members (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'owner'), ($4, $2, $5, 'member')",
		"owner-"+suffix, orgID, owner.ID, "member-"+suffix, member.ID,
	); err != nil {
		t.Fatalf("seed team invitation members: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		"INSERT INTO teams (id, name, organization_id) VALUES ($1, 'Active Team', $2), ($3, 'Archived Team', $2), ($4, 'Foreign Team', $5)",
		teamID, orgID, archivedTeamID, foreignTeamID, foreignOrgID,
	); err != nil {
		t.Fatalf("seed team invitation teams: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		"UPDATE teams SET archived_at = (now() AT TIME ZONE 'UTC') WHERE id = $1", archivedTeamID,
	); err != nil {
		t.Fatalf("archive team invitation fixture: %v", err)
	}

	invitePath := "/api/organizations/" + slug + "/invitations"
	memberInvite := authRequest(t, app, http.MethodPost, invitePath, map[string]any{
		"email": rollbackEmail, "role": "member", "teamId": teamID,
	}, memberCookie)
	if memberInvite.StatusCode != http.StatusForbidden {
		t.Fatalf("member invite status = %d, want %d", memberInvite.StatusCode, http.StatusForbidden)
	}
	memberInvite.Body.Close()

	for label, invalidTeamID := range map[string]struct {
		id   string
		code int
	}{
		"foreign":  {foreignTeamID, http.StatusBadRequest},
		"archived": {archivedTeamID, http.StatusConflict},
	} {
		response := authRequest(t, app, http.MethodPost, invitePath, map[string]any{
			"email": memberEmail, "role": "member", "teamId": invalidTeamID.id,
		}, ownerCookie)
		if response.StatusCode != invalidTeamID.code {
			t.Fatalf("%s team invite status = %d, want %d", label, response.StatusCode, invalidTeamID.code)
		}
		response.Body.Close()
	}

	concurrentEmail := "team-concurrent-" + suffix + "@example.com"
	payload, err := json.Marshal(map[string]any{
		"email": concurrentEmail, "role": "member", "teamId": teamID,
	})
	if err != nil {
		t.Fatalf("encode concurrent invitation: %v", err)
	}
	statuses := make(chan int, 2)
	var invitations sync.WaitGroup
	invitations.Add(2)
	for range 2 {
		go func() {
			defer invitations.Done()
			request := httptest.NewRequest(http.MethodPost, invitePath, bytes.NewReader(payload))
			request.Header.Set("Content-Type", "application/json")
			request.AddCookie(ownerCookie)
			response, requestErr := app.Test(request)
			if requestErr != nil {
				statuses <- 0
				return
			}
			response.Body.Close()
			statuses <- response.StatusCode
		}()
	}
	invitations.Wait()
	close(statuses)
	statusCounts := map[int]int{}
	for status := range statuses {
		statusCounts[status]++
	}
	if statusCounts[http.StatusCreated] != 1 || statusCounts[http.StatusConflict] != 1 {
		t.Fatalf("concurrent invitation statuses = %v, want one 201 and one 409", statusCounts)
	}
	var livePending int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM invitations
		WHERE organization_id = $1 AND lower(email) = lower($2) AND team_id = $3
		  AND status = 'pending' AND expires_at > (now() AT TIME ZONE 'UTC')`,
		orgID, concurrentEmail, teamID,
	).Scan(&livePending); err != nil {
		t.Fatalf("count concurrent invitations: %v", err)
	}
	if livePending != 1 {
		t.Fatalf("concurrent requests created %d live pending invitations, want 1", livePending)
	}

	validInvite := authRequest(t, app, http.MethodPost, invitePath, map[string]any{
		"email": memberEmail, "role": "admin", "teamId": teamID,
	}, ownerCookie)
	if validInvite.StatusCode != http.StatusCreated {
		t.Fatalf("valid team invite status = %d, want %d", validInvite.StatusCode, http.StatusCreated)
	}
	validInvite.Body.Close()
	_, _, _, recordedInvitationURL := emailSender.snapshot()
	validURL, _ := url.Parse(recordedInvitationURL)
	validToken := validURL.Query().Get("token")

	duplicate := authRequest(t, app, http.MethodPost, invitePath, map[string]any{
		"email": memberEmail, "role": "admin", "teamId": teamID,
	}, ownerCookie)
	if duplicate.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate team invite status = %d, want %d", duplicate.StatusCode, http.StatusConflict)
	}
	duplicate.Body.Close()

	accept := func(token string, cookie *http.Cookie) int {
		response := authRequest(t, app, http.MethodPost, "/api/auth/invitations/accept", map[string]any{"token": token}, cookie)
		defer response.Body.Close()
		return response.StatusCode
	}
	if status := accept(validToken, memberCookie); status != http.StatusOK {
		t.Fatalf("team invitation accept status = %d, want %d", status, http.StatusOK)
	}
	if status := accept(validToken, memberCookie); status != http.StatusOK {
		t.Fatalf("team invitation replay status = %d, want %d", status, http.StatusOK)
	}
	var organizationMemberships, teamMemberships int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM members WHERE organization_id = $1 AND user_id = $2", orgID, member.ID).Scan(&organizationMemberships); err != nil {
		t.Fatalf("count organization memberships: %v", err)
	}
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM team_members WHERE team_id = $1 AND user_id = $2", teamID, member.ID).Scan(&teamMemberships); err != nil {
		t.Fatalf("count team memberships: %v", err)
	}
	if organizationMemberships != 1 || teamMemberships != 1 {
		t.Fatalf("accepted membership counts = organization %d team %d, want 1 and 1", organizationMemberships, teamMemberships)
	}

	rollbackInvite := authRequest(t, app, http.MethodPost, invitePath, map[string]any{
		"email": rollbackEmail, "role": "member", "teamId": teamID,
	}, ownerCookie)
	if rollbackInvite.StatusCode != http.StatusCreated {
		t.Fatalf("rollback invite status = %d, want %d", rollbackInvite.StatusCode, http.StatusCreated)
	}
	rollbackInvite.Body.Close()
	_, _, _, recordedInvitationURL = emailSender.snapshot()
	rollbackURL, _ := url.Parse(recordedInvitationURL)
	if _, err := pool.Exec(context.Background(), "UPDATE teams SET archived_at = (now() AT TIME ZONE 'UTC') WHERE id = $1", teamID); err != nil {
		t.Fatalf("archive invited team: %v", err)
	}
	if status := accept(rollbackURL.Query().Get("token"), rollbackCookie); status != http.StatusConflict {
		t.Fatalf("invalid team acceptance status = %d, want %d", status, http.StatusConflict)
	}
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM members WHERE organization_id = $1 AND user_id = $2", orgID, rollbackUser.ID).Scan(&organizationMemberships); err != nil {
		t.Fatalf("count rolled back membership: %v", err)
	}
	if organizationMemberships != 0 {
		t.Fatalf("invalid team acceptance created %d organization memberships", organizationMemberships)
	}

	var leakedTokens int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM auth_events
		WHERE event_type = 'organization_invitation_sent'
		  AND organization_id = $1
		  AND (coalesce(after_state::text, '') LIKE '%token%' OR coalesce(before_state::text, '') LIKE '%token%')`,
		orgID,
	).Scan(&leakedTokens); err != nil {
		t.Fatalf("inspect invitation audit state: %v", err)
	}
	if leakedTokens != 0 {
		t.Fatalf("invitation audit state leaked %d token fields", leakedTokens)
	}
}

type verificationEmailRecorder struct {
	mu              sync.Mutex
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
	r.mu.Lock()
	defer r.mu.Unlock()
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
	r.mu.Lock()
	defer r.mu.Unlock()
	r.invitationURL = invitationURL
	return nil
}

func (r *verificationEmailRecorder) SendVerification(
	_ context.Context,
	to string,
	_ string,
	verificationURL string,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.to = to
	r.verificationURL = verificationURL
	return nil
}

func (r *verificationEmailRecorder) snapshot() (string, string, string, string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.to, r.verificationURL, r.resetURL, r.invitationURL
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
