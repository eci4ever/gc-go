package main

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

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

	app := fiber.New(fiber.Config{
		AppName: "gc-go API",
	})

	api := app.Group("/api")
	api.Get("/health", func(c fiber.Ctx) error {
		if _, err := queries.Ping(c.Context()); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"status": "error",
			})
		}

		return c.JSON(fiber.Map{
			"status": "ok",
			"time":   time.Now().UTC().Format(time.RFC3339),
		})
	})

	log.Fatal(app.Listen("127.0.0.1:3000"))
}
