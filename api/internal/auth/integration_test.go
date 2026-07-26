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
	if err := godotenv.Load("../../.env"); err != nil && !os.IsNotExist(err) {
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
	t.Cleanup(func() {
		if _, err := pool.Exec(
			context.Background(),
			"DELETE FROM users WHERE email = $1",
			email,
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
}

type verificationEmailRecorder struct {
	to              string
	verificationURL string
	resetURL        string
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
	body map[string]string,
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
