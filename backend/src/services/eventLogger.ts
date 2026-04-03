import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { SeverityLevel, LogSource, SEVERITY_LEVELS, LOG_SOURCES } from '../config/default';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: SeverityLevel;
  source: LogSource;
  message: string;
  metadata?: string;
  pattern_detected?: string;
  created_at: number;
}

export class EventLogger {
  private db: Database.Database;
  private static readonly RETENTION_DAYS = 30;

  constructor(db: Database.Database) {
    this.db = db;
    this.initializeTable();
  }

  private initializeTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT,
        pattern_detected TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON event_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON event_logs(level);
      CREATE INDEX IF NOT EXISTS idx_logs_source ON event_logs(source);
      CREATE INDEX IF NOT EXISTS idx_logs_pattern ON event_logs(pattern_detected);
    `);
  }

  log(
    level: SeverityLevel,
    source: LogSource,
    message: string,
    metadata?: Record<string, any>,
    patternDetected?: string
  ): LogEntry {
    const id = uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO event_logs (id, timestamp, level, source, message, metadata, pattern_detected, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      now,
      level,
      source,
      message,
      metadata ? JSON.stringify(metadata) : null,
      patternDetected || null,
      now
    );

    return {
      id,
      timestamp: now,
      level,
      source,
      message,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
      pattern_detected: patternDetected,
      created_at: now,
    };
  }

  debug(source: LogSource, message: string, metadata?: Record<string, any>, patternDetected?: string): LogEntry {
    return this.log('DEBUG', source, message, metadata, patternDetected);
  }

  info(source: LogSource, message: string, metadata?: Record<string, any>, patternDetected?: string): LogEntry {
    return this.log('INFO', source, message, metadata, patternDetected);
  }

  warn(source: LogSource, message: string, metadata?: Record<string, any>, patternDetected?: string): LogEntry {
    return this.log('WARN', source, message, metadata, patternDetected);
  }

  error(source: LogSource, message: string, metadata?: Record<string, any>, patternDetected?: string): LogEntry {
    return this.log('ERROR', source, message, metadata, patternDetected);
  }

  critical(source: LogSource, message: string, metadata?: Record<string, any>, patternDetected?: string): LogEntry {
    return this.log('CRITICAL', source, message, metadata, patternDetected);
  }

  detectSystemPatterns(systemStats: Record<string, any>): void {
    // High CPU usage pattern
    if (systemStats.cpu && systemStats.cpu.currentLoad > 85) {
      this.warn('SYSTEM', 'High CPU usage detected', systemStats.cpu, 'HIGH_CPU');
    }

    // Low memory pattern
    if (systemStats.memory && systemStats.memory.available < systemStats.memory.total * 0.1) {
      this.warn('SYSTEM', 'Low memory detected', systemStats.memory, 'LOW_MEMORY');
    }

    // Low disk space pattern
    if (systemStats.disks) {
      for (const disk of systemStats.disks) {
        const usagePercent = (disk.used / disk.size) * 100;
        if (usagePercent > 90) {
          this.warn(
            'DISK',
            `Low disk space on ${disk.device}`,
            { device: disk.device, usagePercent },
            'LOW_DISK_SPACE'
          );
        }
      }
    }

    // High temperature pattern
    if (systemStats.temperature) {
      const cpuTemp = systemStats.temperature.main || systemStats.temperature.cores?.[0];
      if (cpuTemp && cpuTemp > 85) {
        this.warn('SYSTEM', 'High CPU temperature detected', { temp: cpuTemp }, 'HIGH_TEMPERATURE');
      }
    }
  }

  detectDockerPatterns(containerStats: Record<string, any>): void {
    // Container crash pattern
    if (containerStats.state === 'exited' && containerStats.restartCount > 3) {
      this.error('DOCKER', `Container ${containerStats.name} restarted frequently`, containerStats, 'FREQUENT_RESTARTS');
    }

    // High memory usage by container
    if (containerStats.memory_percent && containerStats.memory_percent > 80) {
      this.warn('DOCKER', `Container ${containerStats.name} using high memory`, containerStats, 'HIGH_CONTAINER_MEMORY');
    }

    // High CPU usage by container
    if (containerStats.cpu_percent && containerStats.cpu_percent > 80) {
      this.warn('DOCKER', `Container ${containerStats.name} using high CPU`, containerStats, 'HIGH_CONTAINER_CPU');
    }
  }

  getLogs(filters?: {
    level?: SeverityLevel;
    source?: LogSource;
    startTime?: number;
    endTime?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }): LogEntry[] {
    let query = 'SELECT * FROM event_logs WHERE 1=1';
    const params: any[] = [];

    if (filters?.level) {
      query += ' AND level = ?';
      params.push(filters.level);
    }

    if (filters?.source) {
      query += ' AND source = ?';
      params.push(filters.source);
    }

    if (filters?.startTime) {
      query += ' AND timestamp >= ?';
      params.push(filters.startTime);
    }

    if (filters?.endTime) {
      query += ' AND timestamp <= ?';
      params.push(filters.endTime);
    }

    if (filters?.search) {
      query += ' AND (message LIKE ? OR metadata LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm);
    }

    query += ' ORDER BY timestamp DESC';

    if (filters?.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters?.offset) {
      query += ' OFFSET ?';
      params.push(filters.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  getStats(): {
    total: number;
    byLevel: Record<SeverityLevel, number>;
    bySource: Record<LogSource, number>;
    lastEntry: LogEntry | null;
  } {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM event_logs').get() as { count: number };

    const byLevel = this.db
      .prepare('SELECT level, COUNT(*) as count FROM event_logs GROUP BY level')
      .all() as { level: SeverityLevel; count: number }[];

    const bySource = this.db
      .prepare('SELECT source, COUNT(*) as count FROM event_logs GROUP BY source')
      .all() as { source: LogSource; count: number }[];

    const lastEntry = this.db
      .prepare('SELECT * FROM event_logs ORDER BY timestamp DESC LIMIT 1')
      .get() as any;

    const levelStats: Record<SeverityLevel, number> = {
      DEBUG: 0,
      INFO: 0,
      WARN: 0,
      ERROR: 0,
      CRITICAL: 0,
    };

    const sourceStats: Record<LogSource, number> = {
      SYSTEM: 0,
      DOCKER: 0,
      MAYA: 0,
      USER: 0,
      NETWORK: 0,
      DISK: 0,
      SECURITY: 0,
      ARRAY: 0,
      FILES: 0,
      SHARES: 0,
      MYSQL: 0,
    };

    for (const entry of byLevel) {
      levelStats[entry.level] = entry.count;
    }

    for (const entry of bySource) {
      sourceStats[entry.source] = entry.count;
    }

    return {
      total: total.count,
      byLevel: levelStats,
      bySource: sourceStats,
      lastEntry: lastEntry
        ? {
            ...lastEntry,
            metadata: lastEntry.metadata ? JSON.parse(lastEntry.metadata) : undefined,
          }
        : null,
    };
  }

  clearOldLogs(daysOld: number = EventLogger.RETENTION_DAYS): number {
    const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    const stmt = this.db.prepare('DELETE FROM event_logs WHERE created_at < ?');
    const result = stmt.run(cutoffTime);
    return result.changes;
  }

  export(filters?: {
    level?: SeverityLevel;
    source?: LogSource;
    startTime?: number;
    endTime?: number;
  }): string {
    const logs = this.getLogs({ ...filters, limit: 100000 });

    const headers = ['Timestamp', 'Level', 'Source', 'Message', 'Metadata', 'Pattern'];
    const rows = logs.map((log) => [
      new Date(log.timestamp).toISOString(),
      log.level,
      log.source,
      log.message,
      log.metadata ? JSON.stringify(log.metadata) : '',
      log.pattern_detected || '',
    ]);

    let csv = headers.map((h) => `"${h}"`).join(',') + '\n';
    for (const row of rows) {
      csv += row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n';
    }

    return csv;
  }
}
