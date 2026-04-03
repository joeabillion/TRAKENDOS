import Database from 'better-sqlite3';
import fs from 'fs';
import { EventLogger } from './eventLogger';

export class DatabaseService {
  private db: Database.Database;
  private logger: EventLogger;

  constructor(db: Database.Database, logger: EventLogger) {
    this.db = db;
    this.logger = logger;
  }

  executeQuery(query: string, params?: any[]): any {
    try {
      // Only allow SELECT, WITH, and PRAGMA queries for safety
      const normalizedQuery = query.trim().toUpperCase();
      const isReadOnly = normalizedQuery.startsWith('SELECT') || normalizedQuery.startsWith('WITH') || normalizedQuery.startsWith('PRAGMA');

      if (!isReadOnly && !this.isSafeModification(query)) {
        throw new Error('Query not allowed');
      }

      const stmt = this.db.prepare(query);
      if (params) {
        return stmt.all(...params);
      }
      return stmt.all();
    } catch (error) {
      this.logger.error('SYSTEM', `Database query failed: ${error}`);
      throw error;
    }
  }

  private isSafeModification(query: string): boolean {
    const normalized = query.trim().toUpperCase();
    // Allow INSERT, UPDATE, DELETE, CREATE, ALTER, DROP only on non-system tables
    if (!normalized.startsWith('INSERT') && !normalized.startsWith('UPDATE') && !normalized.startsWith('DELETE') &&
        !normalized.startsWith('CREATE') && !normalized.startsWith('ALTER') && !normalized.startsWith('DROP')) {
      return false;
    }

    // Prevent access to system tables
    const systemTables = ['settings', 'event_logs', 'maya_notifications', 'update_history'];
    for (const table of systemTables) {
      if (normalized.includes(table.toUpperCase())) {
        return false;
      }
    }

    return true;
  }

  getTables(): Array<{ name: string; type: string; sql: string }> {
    try {
      const result = this.db.prepare(`
        SELECT name, type, sql FROM sqlite_master
        WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all();

      return result as Array<{ name: string; type: string; sql: string }>;
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to get tables: ${error}`);
      throw error;
    }
  }

  private sanitizeIdentifier(name: string): string {
    // Only allow alphanumeric and underscore in identifiers
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid identifier: ${name}`);
    }
    return `"${name}"`;
  }

  getTableSchema(tableName: string): any {
    try {
      const safeName = this.sanitizeIdentifier(tableName);
      return this.db.prepare(`PRAGMA table_info(${safeName})`).all();
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to get table schema: ${error}`);
      throw error;
    }
  }

  getTableData(tableName: string, limit: number = 100, offset: number = 0): any[] {
    try {
      const safeName = this.sanitizeIdentifier(tableName);
      return this.db.prepare(`SELECT * FROM ${safeName} LIMIT ? OFFSET ?`).all(limit, offset);
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to get table data: ${error}`);
      throw error;
    }
  }

  createTable(name: string, columns: Array<{ name: string; type: string; nullable?: boolean; primaryKey?: boolean }>): void {
    try {
      const columnDefs = columns
        .map((col) => {
          let def = `${col.name} ${col.type}`;
          if (col.primaryKey) def += ' PRIMARY KEY';
          if (col.nullable === false) def += ' NOT NULL';
          return def;
        })
        .join(', ');

      const safeName = this.sanitizeIdentifier(name);
      // Also sanitize column names
      columns.forEach(col => this.sanitizeIdentifier(col.name));
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${safeName} (${columnDefs})`);
      this.logger.info('SYSTEM', `Table ${name} created`);
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to create table: ${error}`);
      throw error;
    }
  }

  dropTable(name: string): void {
    try {
      const safeName = this.sanitizeIdentifier(name);
      this.db.exec(`DROP TABLE IF EXISTS ${safeName}`);
      this.logger.info('SYSTEM', `Table ${name} dropped`);
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to drop table: ${error}`);
      throw error;
    }
  }

  async export(): Promise<string> {
    try {
      // Get the database dump
      await this.db.backup('/tmp/trakend-backup.db');

      const buffer = fs.readFileSync('/tmp/trakend-backup.db');
      return buffer.toString('base64');
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to export database: ${error}`);
      throw error;
    }
  }

  async import(data: string): Promise<void> {
    try {

      const buffer = Buffer.from(data, 'base64');
      fs.writeFileSync('/tmp/trakend-import.db', buffer);

      // Restore from backup — read tables from imported DB and insert into main DB
      const backupDb = new Database('/tmp/trakend-import.db');
      const tables = backupDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
      for (const table of tables as any[]) {
        const rows = backupDb.prepare(`SELECT * FROM "${table.name}"`).all();
        if (rows.length > 0) {
          const columns = Object.keys(rows[0] as Record<string, any>);
          const placeholders = columns.map(() => '?').join(', ');
          const insertStmt = this.db.prepare(
            `INSERT OR REPLACE INTO "${table.name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`
          );
          const insertMany = this.db.transaction((rowList: any[]) => {
            for (const row of rowList) {
              insertStmt.run(...columns.map(c => row[c]));
            }
          });
          insertMany(rows);
        }
      }
      backupDb.close();

      this.logger.info('SYSTEM', 'Database imported');
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to import database: ${error}`);
      throw error;
    }
  }

  getStats(): {
    tableCount: number;
    totalRows: number;
    databaseSize: number;
  } {
    try {
      const tables = this.getTables();
      let totalRows = 0;

      for (const table of tables) {
        if (table.type === 'table') {
          const safeTblName = this.sanitizeIdentifier(table.name);
          const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${safeTblName}`).get() as any;
          totalRows += result.count;
        }
      }

      const pageSizeResult = this.db.prepare('PRAGMA page_size').get() as any;
      const pageCountResult = this.db.prepare('PRAGMA page_count').get() as any;
      const databaseSize = pageSizeResult.page_size * pageCountResult.page_count;

      return {
        tableCount: tables.length,
        totalRows,
        databaseSize,
      };
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to get database stats: ${error}`);
      return {
        tableCount: 0,
        totalRows: 0,
        databaseSize: 0,
      };
    }
  }
}
