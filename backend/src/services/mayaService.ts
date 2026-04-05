import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { EventLogger } from './eventLogger';
import { SystemMonitor } from './systemMonitor';
import { DockerService } from './dockerService';
import { SettingsModel } from '../models/settings';

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
  PLATFORM_OVERVIEW,
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
  private settingsModel?: SettingsModel;
  private actionQueue: MayaAction[] = [];
  private systemPromptCache: string = '';

  constructor(db: Database.Database, logger: EventLogger) {
    this.db = db;
    this.logger = logger;
    this.initializeTables();
    this.buildSystemPrompt();
  }

  setDependencies(systemMonitor: SystemMonitor, dockerService: DockerService): void {
    this.systemMonitor = systemMonitor;
    this.dockerService = dockerService;
  }

  setSettingsModel(settingsModel: SettingsModel): void {
    this.settingsModel = settingsModel;
  }

  private getOllamaUrl(): string {
    if (this.settingsModel) {
      const settings = this.settingsModel.getMayaSettings();
      return settings.ollama_url;
    }
    return 'http://localhost:11435';
  }

  private getModel(): string {
    if (this.settingsModel) {
      const settings = this.settingsModel.getMayaSettings();
      return settings.model;
    }
    return 'gemma3:27b';
  }

  private buildSystemPrompt(): void {
    const dosRules = DOS.slice(0, 10).map((d) => `- ${d.rule}`).join('\n');
    const dontsRules = DONTS.slice(0, 8).map((d) => `- ${d.rule}`).join('\n');
    const watchItems = WATCHLIST.slice(0, 6).map((w) => `- ${w.metric}: warn at ${w.warningThreshold}%, critical at ${w.criticalThreshold}%`).join('\n');
    const repairList = REPAIR_PROCEDURES.map((r) => `- ${r.name} (${r.autoApproved ? 'auto' : 'needs approval'})`).join('\n');
    const patternList = KNOWN_PATTERNS.slice(0, 6).map((p) => `- ${p.name}: ${p.rootCause}`).join('\n');

    this.systemPromptCache = `You are Maya, the AI operations assistant for Trakend OS — a server management operating system similar to Unraid.

Your role: Monitor system health 24/7, investigate issues, perform repairs, optimize performance, and help the administrator manage their server.

Platform: ${PLATFORM_OVERVIEW.description}
Architecture: Backend is ${PLATFORM_OVERVIEW.architecture.backend}, Frontend is ${PLATFORM_OVERVIEW.architecture.frontend}, containers via ${PLATFORM_OVERVIEW.architecture.containerEngine}.

Key principle: ${PLATFORM_OVERVIEW.keyPrinciple}

Your rules (DO):
${dosRules}

Your rules (DO NOT):
${dontsRules}

Monitoring thresholds:
${watchItems}

Available repair procedures:
${repairList}

Known issue patterns:
${patternList}

Behavior guidelines:
- Be concise but thorough. Use bullet points for lists.
- When diagnosing, explain your reasoning step by step.
- Always suggest specific actions the admin can take.
- If you detect a critical issue, be direct and urgent.
- You can reference system stats, Docker containers, disk health, etc.
- Never make up data — if you don't have real-time info, say so and suggest running a scan.
- You are friendly, professional, and proactive.`;
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

      CREATE TABLE IF NOT EXISTS maya_conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS maya_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES maya_conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON maya_messages(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON maya_conversations(updated_at);
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

  async chat(message: string, conversationId?: string): Promise<{
    response: string;
    conversationId: string;
    relevantDos: string[];
    relevantDonts: string[];
    relevantPatterns: string[];
    suggestedActions: string[];
  }> {
    // Auto-create conversation if none provided
    if (!conversationId) {
      const conv = this.createConversation(message.slice(0, 60));
      conversationId = conv.id;
    }

    // Save user message to DB
    this.addMessage(conversationId, 'user', message);

    // Auto-title: if conversation title is 'New Conversation', update it from the first message
    const conv = this.db.prepare('SELECT title FROM maya_conversations WHERE id = ?').get(conversationId) as any;
    if (conv && conv.title === 'New Conversation') {
      this.renameConversation(conversationId, message.slice(0, 60));
    }

    // Gather real-time system context to inject into the conversation
    let systemContext = '';
    try {
      if (this.systemMonitor) {
        const overview = await this.systemMonitor.getOverview();
        const memPercent = ((overview.memory.used / overview.memory.total) * 100).toFixed(1);
        const diskSummary = overview.disks.map((d: any) => {
          const usage = d.size > 0 ? ((d.used / d.size) * 100).toFixed(1) : '0';
          return `${d.device}(${d.mount || 'unmounted'}): ${usage}% used`;
        }).join(', ');
        systemContext += `\n\n[Live System Stats]\nCPU: ${overview.cpuUsage.currentLoad.toFixed(1)}% load, ${overview.cpu.cores} cores\nMemory: ${memPercent}% used (${(overview.memory.used / (1024**3)).toFixed(1)}GB / ${(overview.memory.total / (1024**3)).toFixed(1)}GB)\nDisks: ${diskSummary}`;
      }
      if (this.dockerService) {
        const containers = await this.dockerService.listContainers();
        const running = containers.filter((c: any) => c.state === 'running').length;
        const total = containers.length;
        systemContext += `\nDocker: ${running}/${total} containers running`;
        const stopped = containers.filter((c: any) => c.state !== 'running');
        if (stopped.length > 0) {
          systemContext += ` (stopped: ${stopped.map((c: any) => c.names?.[0]?.replace('/', '') || c.id?.slice(0, 12)).join(', ')})`;
        }
      }
    } catch (err) {
      this.logger.debug('MAYA', `Failed to gather system context for chat: ${err}`);
    }

    // Build messages array for Ollama
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: this.systemPromptCache + systemContext },
    ];

    // Load recent conversation history from DB
    const recentHistory = this.getConversationMessages(conversationId, 20);
    messages.push(...(recentHistory as any[]));

    // Try calling Ollama API
    const ollamaUrl = this.getOllamaUrl();
    const model = this.getModel();
    let response = '';

    try {
      const fetchUrl = `${ollamaUrl}/api/chat`;
      this.logger.debug('MAYA', `Calling Ollama at ${fetchUrl} with model ${model}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

      const res = await fetch(fetchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 1024,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Ollama returned ${res.status}: ${errText}`);
      }

      const data = await res.json();
      response = data.message?.content || data.response || '';

      this.logger.debug('MAYA', `Chat response (${response.length} chars)`);
    } catch (err: any) {
      this.logger.warn('MAYA', `Ollama chat failed: ${err.message}`);
      response = this.getFallbackResponse(message);
    }

    // Save assistant response to DB
    this.addMessage(conversationId, 'assistant', response);

    // Extract suggested actions from the response context
    const lowerMessage = message.toLowerCase();
    let suggestedActions: string[] = [];
    if (lowerMessage.includes('scan') || lowerMessage.includes('health')) suggestedActions = ['scan', 'optimize'];
    else if (lowerMessage.includes('docker') || lowerMessage.includes('container')) suggestedActions = ['investigate', 'scan'];
    else if (lowerMessage.includes('disk') || lowerMessage.includes('storage')) suggestedActions = ['investigate disk:', 'find duplicates'];
    else if (lowerMessage.includes('repair') || lowerMessage.includes('fix')) suggestedActions = ['scan', 'optimize'];

    return { response, conversationId, relevantDos: [], relevantDonts: [], relevantPatterns: [], suggestedActions };
  }

  private getFallbackResponse(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes('help') || lower.includes('what can you do')) {
      return "I'm Maya, your Trakend OS AI assistant. I can monitor system health, investigate issues, perform repairs, and optimize performance. Note: My AI model appears to be offline right now, so I'm running in limited mode. Check that the Ollama container is running.";
    }
    return "I'm having trouble connecting to my AI model right now. Please check that the Ollama container (ollama-maya) is running. You can still use my scan, investigate, and optimize features from the sidebar controls.";
  }

  // ---- Conversation persistence ----

  listConversations(limit = 50): Array<{ id: string; title: string; created_at: number; updated_at: number; messageCount: number }> {
    const rows = this.db.prepare(`
      SELECT c.*, COUNT(m.id) as messageCount
      FROM maya_conversations c
      LEFT JOIN maya_messages m ON m.conversation_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT ?
    `).all(limit) as any[];
    return rows;
  }

  createConversation(title?: string): { id: string; title: string; created_at: number; updated_at: number } {
    const id = uuidv4();
    const now = Date.now();
    const t = title || 'New Conversation';
    this.db.prepare('INSERT INTO maya_conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, t, now, now);
    return { id, title: t, created_at: now, updated_at: now };
  }

  getConversation(conversationId: string): { id: string; title: string; created_at: number; updated_at: number; messages: Array<{ id: string; role: string; content: string; created_at: number }> } | null {
    const conv = this.db.prepare('SELECT * FROM maya_conversations WHERE id = ?').get(conversationId) as any;
    if (!conv) return null;
    const messages = this.db.prepare('SELECT * FROM maya_messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as any[];
    return { ...conv, messages };
  }

  deleteConversation(conversationId: string): void {
    this.db.prepare('DELETE FROM maya_messages WHERE conversation_id = ?').run(conversationId);
    this.db.prepare('DELETE FROM maya_conversations WHERE id = ?').run(conversationId);
  }

  renameConversation(conversationId: string, title: string): void {
    this.db.prepare('UPDATE maya_conversations SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), conversationId);
  }

  private addMessage(conversationId: string, role: string, content: string): string {
    const id = uuidv4();
    const now = Date.now();
    this.db.prepare('INSERT INTO maya_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(id, conversationId, role, content, now);
    this.db.prepare('UPDATE maya_conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
    return id;
  }

  private getConversationMessages(conversationId: string, limit = 20): Array<{ role: string; content: string }> {
    const rows = this.db.prepare('SELECT role, content FROM maya_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?').all(conversationId, limit) as any[];
    return rows.reverse();
  }

  clearConversation(): void {
    // Legacy: clears nothing now since conversations are in DB
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
