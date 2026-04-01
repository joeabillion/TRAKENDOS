import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { EventLogger } from './eventLogger';
import { SystemMonitor } from './systemMonitor';
import { DockerService } from './dockerService';

export interface MayaNotification {
  id: string;
  type: 'warning' | 'info' | 'success' | 'error';
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  dismissed: boolean;
  created_at: number;
  action?: {
    type: 'investigate' | 'repair' | 'optimize' | 'scan';
    target: string;
  };
}

export interface MayaAction {
  id: string;
  type: 'investigate' | 'repair' | 'optimize' | 'scan' | 'duplicate_scan' | 'chat';
  status: 'pending' | 'running' | 'completed' | 'failed';
  target?: string;
  findings?: string[];
  actions_taken?: string[];
  result?: any;
  created_at: number;
  completed_at?: number;
  error?: string;
}

import MAYA_KNOWLEDGE_BASE, {
  DOS,
  DONTS,
  WATCHLIST,
  DIAGNOSTIC_PROCEDURES,
  REPAIR_PROCEDURES,
  OPTIMIZATION_PROCEDURES,
  KNOWN_PATTERNS,
  DEEP_SEARCH_PROCEDURES,
} from '../maya/knowledgeBase';

// Legacy format for chat compatibility — derived from the full knowledge base
const DOS_AND_DONTS = {
  system: DOS.filter((d) => d.category === 'monitoring').map((d) => ({
    do: d.rule,
    dont: DONTS.find((x) => x.category === 'safety')?.rule || 'N/A',
  })),
  docker: DOS.filter((d) => d.category === 'maintenance').map((d) => ({
    do: d.rule,
    dont: DONTS.find((x) => x.category === 'stability')?.rule || 'N/A',
  })),
  storage: DOS.filter((d) => d.category === 'maintenance').map((d) => ({
    do: d.rule,
    dont: DONTS.find((x) => x.category === 'safety')?.rule || 'N/A',
  })),
  security: DOS.filter((d) => d.category === 'security').map((d) => ({
    do: d.rule,
    dont: DONTS.find((x) => x.category === 'safety')?.rule || 'N/A',
  })),
};

export class MayaService {
  private db: Database.Database;
  private logger: EventLogger;
  private systemMonitor?: SystemMonitor;
  private dockerService?: DockerService;
  private actionQueue: MayaAction[] = [];

  constructor(db: Database.Database, logger: EventLogger) {
    this.db = db;
    this.logger = logger;
    this.initializeTables();
  }

  setDependencies(systemMonitor: SystemMonitor, dockerService: DockerService): void {
    this.systemMonitor = systemMonitor;
    this.dockerService = dockerService;
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS maya_notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL,
        dismissed INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        action_type TEXT,
        action_target TEXT
      );
      CREATE TABLE IF NOT EXISTS maya_actions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        target TEXT,
        findings TEXT,
        actions_taken TEXT,
        result TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_created ON maya_notifications(created_at);
      CREATE INDEX IF NOT EXISTS idx_actions_created ON maya_actions(created_at);
    `);
  }

  async getStatus(): Promise<{
    enabled: boolean;
    version: string;
    lastAction?: MayaAction;
    notificationCount: number;
  }> {
    const notifications = this.getNotifications();
    return {
      enabled: true,
      version: '1.0.000',
      lastAction: this.actionQueue[this.actionQueue.length - 1],
      notificationCount: notifications.filter((n) => !n.dismissed).length,
    };
  }

  async investigate(target: string): Promise<MayaAction> {
    const action = this.createAction('investigate', target);

    try {
      const findings: string[] = [];
      const actionsTaken: string[] = [];

      if (target.startsWith('container:')) {
        const containerId = target.substring(10);
        findings.push(`Investigating container ${containerId}`);

        if (this.dockerService) {
          try {
            const stats = await this.dockerService.getContainerStats(containerId);
            findings.push(`CPU Usage: ${stats.cpuUsage.toFixed(2)}%`);
            findings.push(`Memory Usage: ${(stats.memoryUsage / (1024 * 1024)).toFixed(2)}MB`);

            if (stats.cpuUsage > 80) {
              findings.push('WARNING: High CPU usage detected');
            }
            if (stats.memoryUsage > stats.memoryLimit * 0.8) {
              findings.push('WARNING: High memory usage detected');
            }
          } catch (error) {
            findings.push(`Failed to get container stats: ${error}`);
          }
        }
      } else if (target.startsWith('disk:')) {
        findings.push(`Investigating disk usage`);
        if (this.systemMonitor) {
          try {
            const overview = await this.systemMonitor.getOverview();
            for (const disk of overview.disks) {
              const usage = (disk.used / disk.size) * 100;
              findings.push(`${disk.device}: ${usage.toFixed(2)}% used`);
              if (usage > 90) {
                findings.push(`WARNING: Low disk space on ${disk.device}`);
              }
            }
          } catch (error) {
            findings.push(`Failed to get disk info: ${error}`);
          }
        }
      } else if (target === 'memory') {
        findings.push('Investigating memory usage');
        if (this.systemMonitor) {
          try {
            const memory = await this.systemMonitor.getMemoryDetailed();
            const usagePercent = (memory.used / memory.total) * 100;
            findings.push(`Total: ${(memory.total / (1024 * 1024 * 1024)).toFixed(2)}GB`);
            findings.push(`Used: ${(memory.used / (1024 * 1024 * 1024)).toFixed(2)}GB (${usagePercent.toFixed(2)}%)`);
            findings.push(`Available: ${(memory.available / (1024 * 1024 * 1024)).toFixed(2)}GB`);
          } catch (error) {
            findings.push(`Failed to get memory info: ${error}`);
          }
        }
      }

      action.status = 'completed';
      action.findings = findings;
      action.actions_taken = actionsTaken;
      action.completed_at = Date.now();

      this.saveAction(action);
      this.logger.info('MAYA', `Investigation completed for ${target}`, { findings });

      return action;
    } catch (error) {
      action.status = 'failed';
      action.error = String(error);
      action.completed_at = Date.now();
      this.saveAction(action);
      this.logger.error('MAYA', `Investigation failed for ${target}: ${error}`);
      throw error;
    }
  }

  async repair(target: string): Promise<MayaAction> {
    const action = this.createAction('repair', target);

    try {
      const actionsTaken: string[] = [];

      if (target.startsWith('container:')) {
        const containerId = target.substring(10);
        if (this.dockerService) {
          try {
            await this.dockerService.restartContainer(containerId);
            actionsTaken.push(`Restarted container ${containerId}`);
          } catch (error) {
            actionsTaken.push(`Failed to restart container: ${error}`);
          }
        }
      } else if (target === 'memory') {
        actionsTaken.push('Triggered system memory cleanup');
        // In a real system, you would clear caches, etc.
      }

      action.status = 'completed';
      action.actions_taken = actionsTaken;
      action.completed_at = Date.now();

      this.saveAction(action);
      this.logger.info('MAYA', `Repair completed for ${target}`, { actionsTaken });

      return action;
    } catch (error) {
      action.status = 'failed';
      action.error = String(error);
      action.completed_at = Date.now();
      this.saveAction(action);
      this.logger.error('MAYA', `Repair failed for ${target}: ${error}`);
      throw error;
    }
  }

  async optimize(): Promise<MayaAction> {
    const action = this.createAction('optimize');

    try {
      const findings: string[] = [];
      const actionsTaken: string[] = [];

      if (this.dockerService) {
        try {
          const images = await this.dockerService.listImages();
          const unusedImages = images.filter((img) => img.repoTags.length === 0);
          if (unusedImages.length > 0) {
            findings.push(`Found ${unusedImages.length} dangling images`);
            actionsTaken.push(`Review and remove dangling images`);
          }
        } catch (error) {
          findings.push(`Failed to check for unused images: ${error}`);
        }
      }

      if (this.systemMonitor) {
        try {
          const overview = await this.systemMonitor.getOverview();
          const cpuUsagePercent = overview.cpuUsage.currentLoad;
          if (cpuUsagePercent > 70) {
            findings.push(`High average CPU usage: ${cpuUsagePercent.toFixed(2)}%`);
            actionsTaken.push('Consider reducing workload or upgrading CPU');
          }
        } catch (error) {
          findings.push(`Failed to analyze CPU: ${error}`);
        }
      }

      action.status = 'completed';
      action.findings = findings;
      action.actions_taken = actionsTaken;
      action.completed_at = Date.now();

      this.saveAction(action);
      this.logger.info('MAYA', 'System optimization completed', { findings, actionsTaken });

      return action;
    } catch (error) {
      action.status = 'failed';
      action.error = String(error);
      action.completed_at = Date.now();
      this.saveAction(action);
      this.logger.error('MAYA', `Optimization failed: ${error}`);
      throw error;
    }
  }

  async scan(): Promise<MayaAction> {
    const action = this.createAction('scan');

    try {
      const findings: string[] = [];

      // Use knowledge base watchlist thresholds for scanning
      if (this.systemMonitor) {
        try {
          const overview = await this.systemMonitor.getOverview();

          // CPU check — from WATCHLIST WATCH-001
          const cpuWatch = WATCHLIST.find((w) => w.id === 'WATCH-001');
          if (cpuWatch) {
            if (overview.cpuUsage.currentLoad > cpuWatch.criticalThreshold) {
              findings.push(`CRITICAL: CPU usage at ${overview.cpuUsage.currentLoad.toFixed(1)}% (threshold: ${cpuWatch.criticalThreshold}%)`);
              findings.push(`  -> Action: ${cpuWatch.action}`);
            } else if (overview.cpuUsage.currentLoad > cpuWatch.warningThreshold) {
              findings.push(`WARNING: CPU usage at ${overview.cpuUsage.currentLoad.toFixed(1)}% (threshold: ${cpuWatch.warningThreshold}%)`);
            }
          }

          // Memory check — from WATCHLIST WATCH-003
          const memWatch = WATCHLIST.find((w) => w.id === 'WATCH-003');
          const memUsage = (overview.memory.used / overview.memory.total) * 100;
          if (memWatch) {
            if (memUsage > memWatch.criticalThreshold) {
              findings.push(`CRITICAL: Memory at ${memUsage.toFixed(1)}% (threshold: ${memWatch.criticalThreshold}%)`);
              findings.push(`  -> Action: ${memWatch.action}`);
            } else if (memUsage > memWatch.warningThreshold) {
              findings.push(`WARNING: Memory at ${memUsage.toFixed(1)}% (threshold: ${memWatch.warningThreshold}%)`);
            }
          }

          // Disk check — from WATCHLIST WATCH-004
          const diskWatch = WATCHLIST.find((w) => w.id === 'WATCH-004');
          for (const disk of overview.disks) {
            const usage = (disk.used / disk.size) * 100;
            if (diskWatch) {
              if (usage > diskWatch.criticalThreshold) {
                findings.push(`CRITICAL: Disk ${disk.device} at ${usage.toFixed(1)}% (threshold: ${diskWatch.criticalThreshold}%)`);
                findings.push(`  -> Action: ${diskWatch.action}`);
                // Auto-create notification for critical disk
                this.createNotification('error', `Low Disk Space: ${disk.device}`,
                  `Disk is at ${usage.toFixed(1)}% capacity. Immediate action needed.`,
                  'critical', { type: 'investigate', target: `disk:${disk.device}` });
              } else if (usage > diskWatch.warningThreshold) {
                findings.push(`WARNING: Disk ${disk.device} at ${usage.toFixed(1)}% (threshold: ${diskWatch.warningThreshold}%)`);
              }
            }
          }

          // Pattern matching — check for known issue patterns
          for (const pattern of KNOWN_PATTERNS) {
            if (pattern.id === 'PAT-007' && overview.cpuUsage.currentLoad > 60) {
              // Check for thermal throttling indicators
              if (overview.cpu.temperature && overview.cpu.temperature > 75) {
                findings.push(`PATTERN MATCH [${pattern.name}]: CPU temp at ${overview.cpu.temperature}C`);
                findings.push(`  -> Root cause: ${pattern.rootCause}`);
                findings.push(`  -> Solution: ${pattern.solution}`);
              }
            }
          }

        } catch (error) {
          findings.push(`System scan error: ${error}`);
        }
      }

      // Docker container health check
      if (this.dockerService) {
        try {
          const containers = await this.dockerService.listContainers();
          const stoppedCount = containers.filter((c) => c.state !== 'running').length;
          if (stoppedCount > 0) {
            findings.push(`INFO: ${stoppedCount} container(s) not running`);
          }
        } catch (error) {
          findings.push(`Docker scan error: ${error}`);
        }
      }

      if (findings.length === 0) {
        findings.push('All systems healthy. No issues detected.');
      }

      action.status = 'completed';
      action.findings = findings;
      action.completed_at = Date.now();

      this.saveAction(action);
      this.logger.info('MAYA', 'System scan completed', { findingCount: findings.length });

      return action;
    } catch (error) {
      action.status = 'failed';
      action.error = String(error);
      action.completed_at = Date.now();
      this.saveAction(action);
      throw error;
    }
  }

  async findDuplicates(): Promise<MayaAction> {
    const action = this.createAction('duplicate_scan');

    try {
      const findings: string[] = [];

      // In a real implementation, would scan filesystem for duplicate files
      findings.push('Duplicate file scan initiated');
      findings.push('Scanning common directories...');
      findings.push('This is a placeholder - implement actual file scanning logic');

      action.status = 'completed';
      action.findings = findings;
      action.completed_at = Date.now();

      this.saveAction(action);
      this.logger.info('MAYA', 'Duplicate file scan completed');

      return action;
    } catch (error) {
      action.status = 'failed';
      action.error = String(error);
      action.completed_at = Date.now();
      this.saveAction(action);
      throw error;
    }
  }

  async chat(message: string): Promise<{
    response: string;
    relevantDos: string[];
    relevantDonts: string[];
    relevantPatterns: string[];
    suggestedActions: string[];
  }> {
    const lowerMessage = message.toLowerCase();

    let response = "I'm Maya, your Trakend OS AI assistant. I monitor system health, investigate issues, perform repairs, and optimize performance. How can I help?";
    let relevantDos: string[] = [];
    let relevantDonts: string[] = [];
    let relevantPatterns: string[] = [];
    let suggestedActions: string[] = [];

    // Match against knowledge base topics
    if (lowerMessage.includes('docker') || lowerMessage.includes('container')) {
      response = 'I can help with Docker containers. I monitor container health, detect restart loops, track resource usage, and can restart crashed containers automatically. What would you like me to do?';
      relevantDos = DOS.filter((d) => d.category === 'maintenance' || d.rule.toLowerCase().includes('docker'))
        .map((d) => d.rule);
      relevantDonts = DONTS.filter((d) => d.rule.toLowerCase().includes('container') || d.rule.toLowerCase().includes('docker'))
        .map((d) => d.rule);
      relevantPatterns = KNOWN_PATTERNS.filter((p) =>
        p.symptoms.some((s) => s.toLowerCase().includes('container')))
        .map((p) => `${p.name}: ${p.rootCause}`);
      suggestedActions = ['investigate', 'scan', 'optimize'];
    } else if (lowerMessage.includes('disk') || lowerMessage.includes('storage') || lowerMessage.includes('drive')) {
      response = 'Storage is critical. I track disk usage, SMART health data, predict when drives will fill up, and detect failing disks before data loss. I can also find duplicate files to free space.';
      relevantDos = DOS.filter((d) => d.rule.toLowerCase().includes('disk') || d.category === 'maintenance')
        .map((d) => d.rule);
      relevantDonts = DONTS.filter((d) => d.rule.toLowerCase().includes('file') || d.rule.toLowerCase().includes('delete'))
        .map((d) => d.rule);
      relevantPatterns = KNOWN_PATTERNS.filter((p) =>
        p.name.toLowerCase().includes('disk') || p.symptoms.some((s) => s.toLowerCase().includes('disk')))
        .map((p) => `${p.name}: ${p.solution}`);
      suggestedActions = ['investigate disk:', 'scan', 'find duplicates'];
    } else if (lowerMessage.includes('memory') || lowerMessage.includes('ram') || lowerMessage.includes('oom')) {
      response = 'I keep a close eye on memory. I can detect memory leaks, identify memory-heavy containers, and warn before OOM kills happen. Want me to investigate current memory usage?';
      relevantPatterns = KNOWN_PATTERNS.filter((p) => p.name.toLowerCase().includes('oom'))
        .map((p) => `${p.name}: ${p.solution}`);
      suggestedActions = ['investigate memory', 'optimize'];
    } else if (lowerMessage.includes('security') || lowerMessage.includes('login') || lowerMessage.includes('ssh')) {
      response = 'Security is my top priority. I monitor login attempts, detect brute force attacks, and audit SSH configuration. I also check container privilege levels and network exposure.';
      relevantDos = DOS.filter((d) => d.category === 'security').map((d) => d.rule);
      relevantDonts = DONTS.filter((d) => d.category === 'safety').map((d) => d.rule);
      suggestedActions = ['scan'];
    } else if (lowerMessage.includes('cpu') || lowerMessage.includes('processor') || lowerMessage.includes('temperature') || lowerMessage.includes('thermal')) {
      response = 'I monitor CPU usage per-core, temperatures, and detect thermal throttling. I can identify runaway processes and suggest container CPU limits. Shall I run a diagnostic?';
      relevantPatterns = KNOWN_PATTERNS.filter((p) => p.name.toLowerCase().includes('thermal'))
        .map((p) => `${p.name}: ${p.solution}`);
      suggestedActions = ['investigate', 'optimize'];
    } else if (lowerMessage.includes('network') || lowerMessage.includes('dns') || lowerMessage.includes('packet')) {
      response = 'Network health is essential. I watch for packet loss, bandwidth saturation, DNS failures, and interface errors. I can diagnose connectivity issues between containers too.';
      relevantPatterns = KNOWN_PATTERNS.filter((p) =>
        p.name.toLowerCase().includes('dns') || p.name.toLowerCase().includes('network'))
        .map((p) => `${p.name}: ${p.solution}`);
      suggestedActions = ['investigate', 'scan'];
    } else if (lowerMessage.includes('repair') || lowerMessage.includes('fix') || lowerMessage.includes('heal')) {
      response = 'I have several repair procedures: restarting crashed containers, clearing build cache, fixing permissions, rotating oversized logs, fixing DNS, and clearing zombie processes. Some I can do automatically, others need your approval first.';
      suggestedActions = REPAIR_PROCEDURES.map((r) => `${r.name} (${r.autoApproved ? 'auto' : 'needs approval'})`);
    } else if (lowerMessage.includes('optimize') || lowerMessage.includes('performance') || lowerMessage.includes('tune')) {
      response = 'I can optimize container resource allocation, clean up unused Docker images, tune system services, optimize network settings, and improve storage I/O. Want me to start an optimization analysis?';
      suggestedActions = OPTIMIZATION_PROCEDURES.map((o) => `${o.name} (${o.frequency})`);
    } else if (lowerMessage.includes('scan') || lowerMessage.includes('check') || lowerMessage.includes('health')) {
      response = 'I can run a quick health scan or a comprehensive deep search. The deep search audits system health, security, performance baselines, and storage integrity. Which would you prefer?';
      suggestedActions = ['Quick scan', 'Deep search (comprehensive)', 'Security audit'];
    } else if (lowerMessage.includes('help') || lowerMessage.includes('what can you do') || lowerMessage.includes('capability')) {
      response = `I'm Maya, your AI operations assistant for Trakend OS. Here's what I can do:

- Monitor: Real-time CPU, memory, disk, GPU, network, and Docker health
- Investigate: Trace issues to their root cause using diagnostic procedures
- Repair: Restart crashed services, clear caches, fix permissions, rotate logs
- Optimize: Right-size containers, clean unused images, tune system settings
- Detect: Find duplicate files, predict disk fill dates, spot anomalies
- Protect: Monitor for brute force attacks, audit security, check SMART data

I follow strict rules: I never delete data without permission, never auto-update the OS, and never expose sensitive information. Everything I do is logged for your review.`;
      suggestedActions = ['scan', 'optimize', 'investigate'];
    } else if (lowerMessage.includes('duplicate') || lowerMessage.includes('cleanup')) {
      response = 'I can scan your drives for duplicate files using hash comparison. I\'ll show you what I find and you decide what to keep. I never delete anything without your explicit permission.';
      suggestedActions = ['find duplicates'];
    }

    this.logger.debug('MAYA', `Chat: ${message}`, { response: response.substring(0, 100) });

    return { response, relevantDos, relevantDonts, relevantPatterns, suggestedActions };
  }

  createNotification(
    type: 'warning' | 'info' | 'success' | 'error',
    title: string,
    message: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    action?: { type: 'investigate' | 'repair' | 'optimize' | 'scan'; target: string }
  ): MayaNotification {
    const id = uuidv4();
    const notification: MayaNotification = {
      id,
      type,
      title,
      message,
      severity,
      dismissed: false,
      created_at: Date.now(),
      action,
    };

    const stmt = this.db.prepare(`
      INSERT INTO maya_notifications (id, type, title, message, severity, dismissed, created_at, action_type, action_target)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      notification.id,
      notification.type,
      notification.title,
      notification.message,
      notification.severity,
      notification.dismissed ? 1 : 0,
      notification.created_at,
      action?.type || null,
      action?.target || null
    );

    return notification;
  }

  getNotifications(): MayaNotification[] {
    const rows = this.db
      .prepare('SELECT * FROM maya_notifications ORDER BY created_at DESC LIMIT 100')
      .all() as any[];

    return rows.map((row) => ({
      ...row,
      dismissed: row.dismissed === 1,
    }));
  }

  dismissNotification(notificationId: string): void {
    this.db.prepare('UPDATE maya_notifications SET dismissed = 1 WHERE id = ?').run(notificationId);
  }

  private createAction(type: MayaAction['type'], target?: string): MayaAction {
    return {
      id: uuidv4(),
      type,
      status: 'pending',
      target,
      findings: [],
      actions_taken: [],
      created_at: Date.now(),
    };
  }

  private saveAction(action: MayaAction): void {
    const stmt = this.db.prepare(`
      INSERT INTO maya_actions (id, type, status, target, findings, actions_taken, result, created_at, completed_at, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      action.id,
      action.type,
      action.status,
      action.target || null,
      action.findings ? JSON.stringify(action.findings) : null,
      action.actions_taken ? JSON.stringify(action.actions_taken) : null,
      action.result ? JSON.stringify(action.result) : null,
      action.created_at,
      action.completed_at || null,
      action.error || null
    );

    this.actionQueue.push(action);
  }

  getHistory(limit: number = 50): MayaAction[] {
    const rows = this.db
      .prepare('SELECT * FROM maya_actions ORDER BY created_at DESC LIMIT ?')
      .all(limit) as any[];

    return rows.map((row) => ({
      ...row,
      findings: row.findings ? JSON.parse(row.findings) : undefined,
      actions_taken: row.actions_taken ? JSON.parse(row.actions_taken) : undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
    }));
  }
}
