package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

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

var applicationTables = []string{
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
	reset := flag.Bool(
		"reset",
		false,
		"drop all application tables and rebuild the database from migrations",
	)
	flag.Parse()

	if err := godotenv.Load("../.env"); err != nil && !os.IsNotExist(err) {
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

	if *reset {
		resetDatabase(ctx, connection)
		fmt.Printf("Reset database %q.\n", config.Database)
	}

	migrations, err := migrationFiles("db/migrations")
	if err != nil {
		log.Fatalf("list migrations: %v", err)
	}

	existingTables, err := findExistingTables(ctx, connection)
	if err != nil {
		log.Fatalf("inspect database schema: %v", err)
	}
	if len(existingTables) > 0 && !containsAll(existingTables, applicationTables) {
		log.Fatalf(
			"refusing to migrate a partial installation; existing tables: %v",
			existingTables,
		)
	}

	if _, err := connection.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMP NOT NULL DEFAULT now()
		)`); err != nil {
		log.Fatalf("create migration ledger: %v", err)
	}

	applied, err := appliedMigrations(ctx, connection)
	if err != nil {
		log.Fatalf("read migration ledger: %v", err)
	}

	if containsAll(existingTables, applicationTables) &&
		len(applied) == 0 &&
		len(migrations) > 0 {
		if _, err := connection.Exec(
			ctx,
			"INSERT INTO schema_migrations (version) VALUES ($1)",
			migrations[0],
		); err != nil {
			log.Fatalf("baseline existing schema: %v", err)
		}
		applied[migrations[0]] = struct{}{}
		fmt.Printf("Baselined existing database at %s.\n", migrations[0])
	}

	appliedCount := 0
	for _, migration := range migrations {
		if _, done := applied[migration]; done {
			continue
		}
		applyMigration(ctx, connection, filepath.Join("db/migrations", migration))
		appliedCount++
		fmt.Printf("Applied %s.\n", migration)
	}

	if appliedCount == 0 {
		fmt.Println("Database is up to date.")
	}
}

func resetDatabase(ctx context.Context, connection *pgx.Conn) {
	transaction, err := connection.Begin(ctx)
	if err != nil {
		log.Fatalf("begin database reset: %v", err)
	}
	defer transaction.Rollback(ctx)

	_, err = transaction.Exec(ctx, `
	DROP TABLE IF EXISTS
			notifications,
			auth_events,
			invitations,
			team_members,
			organization_role_permissions,
			members,
			organization_roles,
			two_factor_challenges,
			two_factors,
			verifications,
			accounts,
			sessions,
			teams,
			organizations,
			users,
			schema_migrations
		CASCADE;
		DROP FUNCTION IF EXISTS set_updated_at() CASCADE;
	`)
	if err != nil {
		log.Fatalf("reset database: %v", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		log.Fatalf("commit database reset: %v", err)
	}
}

func migrationFiles(directory string) ([]string, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, err
	}

	var migrations []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			migrations = append(migrations, entry.Name())
		}
	}
	sort.Strings(migrations)
	return migrations, nil
}

func appliedMigrations(
	ctx context.Context,
	connection *pgx.Conn,
) (map[string]struct{}, error) {
	rows, err := connection.Query(
		ctx,
		"SELECT version FROM schema_migrations ORDER BY version",
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	applied := make(map[string]struct{})
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		applied[version] = struct{}{}
	}
	return applied, rows.Err()
}

func applyMigration(ctx context.Context, connection *pgx.Conn, path string) {
	schema, err := os.ReadFile(path)
	if err != nil {
		log.Fatalf("read migration %s: %v", path, err)
	}

	transaction, err := connection.Begin(ctx)
	if err != nil {
		log.Fatalf("begin migration %s: %v", path, err)
	}
	defer transaction.Rollback(ctx)

	if _, err := transaction.Exec(ctx, string(schema)); err != nil {
		log.Fatalf("apply migration %s: %v", path, err)
	}
	if _, err := transaction.Exec(
		ctx,
		"INSERT INTO schema_migrations (version) VALUES ($1)",
		filepath.Base(path),
	); err != nil {
		log.Fatalf("record migration %s: %v", path, err)
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
