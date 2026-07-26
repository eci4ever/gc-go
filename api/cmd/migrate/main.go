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
    'users',
    'sessions',
    'accounts',
    'verifications',
    'organizations',
    'teams',
    'team_members',
    'members',
    'invitations'
  )
ORDER BY table_name`

var pluralTables = []string{
	"users",
	"sessions",
	"accounts",
	"verifications",
	"organizations",
	"teams",
	"team_members",
	"members",
	"invitations",
}

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

	if containsAll(existingTables, pluralTables) {
		fmt.Println("Database schema is already present; no migration was applied.")
		return
	}
	if len(existingTables) > 0 {
		log.Fatalf(
			"refusing to apply schema over a partial installation; existing tables: %v",
			existingTables,
		)
	}

	applySQLFile(ctx, connection, "db/migrations/001_initial_schema.sql")

	fmt.Println("Database schema migration applied successfully.")
}

func applySQLFile(ctx context.Context, connection *pgx.Conn, path string) {
	schema, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("read migration file %s: %v", path, err)
	}

	transaction, err := connection.Begin(ctx)
	if err != nil {
		log.Fatalf("begin migration transaction: %v", err)
	}
	defer transaction.Rollback(ctx)

	if _, err := transaction.Exec(ctx, string(schema)); err != nil {
		log.Fatalf("apply migration %s: %v", path, err)
	}
	if err := transaction.Commit(ctx); err != nil {
		log.Fatalf("commit migration %s: %v", path, err)
	}
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

func containsAll(existing []string, expected []string) bool {
	if len(existing) < len(expected) {
		return false
	}

	tableSet := make(map[string]struct{}, len(existing))
	for _, table := range existing {
		tableSet[table] = struct{}{}
	}

	for _, table := range expected {
		if _, found := tableSet[table]; !found {
			return false
		}
	}

	return true
}
