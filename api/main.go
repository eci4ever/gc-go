package main

import (
	"log"
	"time"

	"github.com/gofiber/fiber/v3"
)

func main() {
	app := fiber.New(fiber.Config{
		AppName: "gc-go API",
	})

	api := app.Group("/api")
	api.Get("/health", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status": "ok",
			"time":   time.Now().UTC().Format(time.RFC3339),
		})
	})

	log.Fatal(app.Listen("127.0.0.1:3000"))
}
