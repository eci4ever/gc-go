package main

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"gc-go/api/internal/auth"
	"gc-go/api/internal/db"
)

func main() {
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Fatalf("load environment: %v", err)
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	ctx := context.Background()
	database, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("create database pool: %v", err)
	}
	defer database.Close()

	if err := database.Ping(ctx); err != nil {
		log.Fatalf("connect to database: %v", err)
	}

	queries := db.New(database)
	cookieSecure := os.Getenv("APP_ENV") == "production"

	app := fiber.New(fiber.Config{
		AppName: "gc-go API",
	})

	api := app.Group("/api")
	authHandler := auth.NewHandler(database, queries, cookieSecure)
	authHandler.Register(api.Group("/auth"))
	authHandler.RegisterDashboard(api)
	api.Get("/health", func(c fiber.Ctx) error {
		started := time.Now()
		_, databaseError := queries.Ping(c.Context())
		latency := time.Since(started)

		response := fiber.Map{
			"status":        "ok",
			"api":           "ok",
			"db":            "ok",
			"db_latency_ms": float64(latency.Microseconds()) / 1000,
			"time":          time.Now().UTC().Format(time.RFC3339),
		}

		if databaseError != nil {
			response["status"] = "degraded"
			response["db"] = "error"
			response["db_latency_ms"] = nil
		}

		return c.JSON(response)
	})

	log.Fatal(app.Listen("127.0.0.1:3000"))
}
