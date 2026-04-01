import { spawn } from 'node-pty';
import { EventLogger } from './eventLogger';
import { v4 as uuidv4 } from 'uuid';

export interface TerminalSession {
  id: string;
  name: string;
  pid: number;
  created_at: number;
  last_activity: number;
}

export class TerminalService {
  private sessions: Map<string, any> = new Map();
  private logger: EventLogger;
  private readonly CLEANUP_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  constructor(logger: EventLogger) {
    this.logger = logger;
  }

  createSession(name?: string): TerminalSession {
    const id = uuidv4();
    const sessionName = name || `Terminal ${Object.keys(this.sessions).length + 1}`;

    try {
      const pty = spawn('bash', [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: '/root',
        env: process.env as any,
      });

      const session: TerminalSession = {
        id,
        name: sessionName,
        pid: pty.pid,
        created_at: Date.now(),
        last_activity: Date.now(),
      };

      this.sessions.set(id, {
        ...session,
        pty,
        dataHandlers: new Set<(data: string) => void>(),
      });

      this.logger.info('SYSTEM', `Terminal session created: ${sessionName} (${id})`);

      // Auto-cleanup after inactivity
      setTimeout(() => {
        if (this.sessions.has(id)) {
          const session = this.sessions.get(id);
          if (Date.now() - session.last_activity > this.CLEANUP_TIMEOUT) {
            this.closeSession(id);
          }
        }
      }, this.CLEANUP_TIMEOUT);

      return session;
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to create terminal session: ${error}`);
      throw error;
    }
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      if (session.pty) {
        session.pty.kill();
      }
      this.sessions.delete(sessionId);
      this.logger.info('SYSTEM', `Terminal session closed: ${sessionId}`);
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to close terminal session: ${error}`);
    }
  }

  getSessions(): TerminalSession[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      name: s.name,
      pid: s.pid,
      created_at: s.created_at,
      last_activity: s.last_activity,
    }));
  }

  writeData(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      session.pty.write(data);
      session.last_activity = Date.now();
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to write to terminal: ${error}`);
      throw error;
    }
  }

  onData(sessionId: string, handler: (data: string) => void): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.dataHandlers.add(handler);

    // Set up the event listener if this is the first handler
    if (session.dataHandlers.size === 1) {
      session.pty.on('data', (data: string) => {
        for (const handler of session.dataHandlers) {
          handler(data);
        }
        session.last_activity = Date.now();
      });

      session.pty.on('exit', () => {
        this.closeSession(sessionId);
      });
    }

    // Return unsubscribe function
    return () => {
      session.dataHandlers.delete(handler);
    };
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      session.pty.resize(cols, rows);
      session.last_activity = Date.now();
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to resize terminal: ${error}`);
      throw error;
    }
  }

  closeAllSessions(): void {
    for (const [sessionId] of this.sessions) {
      this.closeSession(sessionId);
    }
  }
}
