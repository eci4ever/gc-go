package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

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
	NewHandler(pool, db.New(pool), false).Register(app.Group("/api/auth"))

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
		"password": "correct-horse-battery-staple",
	}, nil)
	if loginResponse.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d, want %d", loginResponse.StatusCode, http.StatusOK)
	}
	loginResponse.Body.Close()
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
		Timeout:       10 * time.Second,
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
