package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
)

const existingTablesQuery = `
SELECT table_name
FROM information_schema.tables
WHERE table_schema = current_schema()
  AND table_name IN (
    'user',
    'session',
    'account',
    'verification',
    'organization',
    'team',
    'team_member',
    'member',
    'invitation'
  )
ORDER BY table_name`

func main() {
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Fatalf("load environment: %v", err)
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}

	config, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		log.Fatalf("parse database configuration: %v", err)
	}
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	ctx := context.Background()
	connection, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		log.Fatalf("connect to database: %v", err)
	}
	defer connection.Close(ctx)

	existingTables, err := findExistingTables(ctx, connection)
	if err != nil {
		log.Fatalf("inspect database schema: %v", err)
	}

	if len(existingTables) == 9 {
		fmt.Println("Database schema is already present; no migration was applied.")
		return
	}
	if len(existingTables) > 0 {
		log.Fatalf(
			"refusing to apply schema over a partial installation; existing tables: %v",
			existingTables,
		)
	}

	schema, err := os.ReadFile("db/schema.sql")
	if err != nil {
		log.Fatalf("read schema: %v", err)
	}

	transaction, err := connection.Begin(ctx)
	if err != nil {
		log.Fatalf("begin migration transaction: %v", err)
	}
	defer transaction.Rollback(ctx)

	if _, err := transaction.Exec(ctx, string(schema)); err != nil {
		log.Fatalf("apply schema: %v", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		log.Fatalf("commit migration: %v", err)
	}

	fmt.Println("Database schema migration applied successfully.")
}

func findExistingTables(
	ctx context.Context,
	connection *pgx.Conn,
) ([]string, error) {
	rows, err := connection.Query(ctx, existingTablesQuery)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var table string
		if err := rows.Scan(&table); err != nil {
			return nil, err
		}
		tables = append(tables, table)
	}

	return tables, rows.Err()
}
