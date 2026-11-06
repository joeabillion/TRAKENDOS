import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { TerminalService, ShellChoice } from '../services/terminalService';
import { WebSocket } from 'ws';

const VALID_SHELLS: ShellChoice[] = ['auto', 'bash', 'pwsh', 'sh', 'zsh'];

function ownerOf(req: AuthRequest): string {
  return req.user?.id || req.user?.username || 'default';
}

/**
 * REST surface:
 *   POST   /api/terminal/sessions          { name?, shell?, cols?, rows? } -> TerminalSession
 *   GET    /api/terminal/sessions          -> TerminalSession[] (current user's)
 *   GET    /api/terminal/sessions/:id      -> TerminalSession | 404  (exists check for re-attach)
 *   PATCH  /api/terminal/sessions/:id      { name } -> TerminalSession
 *   DELETE /api/terminal/sessions/:id      -> { success: true }
 *   GET    /api/terminal/shells            -> [{ value, label, cmd }]
 */
export function createTerminalRouter(terminalService: TerminalService): Router {
  const router = Router();

  router.post('/sessions', (req: AuthRequest, res: Response) => {
    try {
      const name = req.body?.name || undefined;
      const rawShell = (req.body?.shell || 'auto') as string;
      const shell: ShellChoice = VALID_SHELLS.includes(rawShell as ShellChoice)
        ? (rawShell as ShellChoice)
        : 'auto';
      const cols = Number(req.body?.cols) || undefined;
      const rows = Number(req.body?.rows) || undefined;
      const session = terminalService.createSession(name, shell, ownerOf(req), { cols, rows });
      res.json(session);
    } catch (error: any) {
      const msg = error?.message || String(error);
      const status = /limit reached/i.test(msg) ? 429 : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.get('/sessions', (req: AuthRequest, res: Response) => {
    try {
      res.json(terminalService.getSessions(ownerOf(req)));
    } catch (error: any) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  // Exists check — the frontend calls this before re-attaching after a reload/reconnect.
  router.get('/sessions/:id', (req: AuthRequest, res: Response) => {
    const session = terminalService.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found', exists: false });
      return;
    }
    res.json({ ...session, exists: true });
  });

  router.patch('/sessions/:id', (req: AuthRequest, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const session = terminalService.renameSession(req.params.id, name);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(session);
  });

  router.delete('/sessions/:id', (req: AuthRequest, res: Response) => {
    try {
      terminalService.closeSession(req.params.id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  // List shells installed on this host so the frontend can offer a picker
  router.get('/shells', (_req: AuthRequest, res: Response) => {
    try {
      res.json(terminalService.listAvailableShells());
    } catch (error: any) {
      res.status(500).json({ error: error?.message || String(error) });
    }
  });

  return router;
}

/**
 * WebSocket protocol for /ws/terminal/:sessionId
 *
 * client -> server (JSON):
 *   { type: 'terminal:input',  data: string }            raw keystrokes / paste (bracketed-paste markers pass through)
 *   { type: 'terminal:resize', cols: number, rows: number }
 *   { type: 'terminal:replay' }                          ask for the recent-output buffer (used after reload / re-attach)
 *   { type: 'terminal:ping' }                            keepalive
 *
 * server -> client (JSON):
 *   { type: 'terminal:attached', sessionId, shell, pid, created_at, cols, rows, idle_remaining_ms }
 *   { type: 'terminal:data',     sessionId, data: string }
 *   { type: 'terminal:replay',   sessionId, data: string }   response to terminal:replay (may be '')
 *   { type: 'terminal:idle-warning', sessionId, secondsLeft }
 *   { type: 'terminal:exit',     sessionId, exitCode, signal? }  followed by close(1000)
 *   { type: 'terminal:error',    sessionId, message }
 *   { type: 'terminal:pong' }
 *
 * Close codes: 1000 normal (shell exited), 4404 session not found, 1011 internal error.
 */
export function setupTerminalWebSocket(ws: WebSocket, sessionId: string, terminalService: TerminalService): void {
  const send = (payload: Record<string, unknown>) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ sessionId, ...payload }));
      } catch {
        /* socket went away */
      }
    }
  };

  const info = terminalService.getSession(sessionId);
  if (!info) {
    send({ type: 'terminal:error', message: 'Session not found' });
    try {
      ws.close(4404, 'Session not found');
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    const unsubscribeData = terminalService.onData(sessionId, (data: string) => {
      send({ type: 'terminal:data', data });
    });

    const unsubscribeExit = terminalService.onExit(sessionId, ({ exitCode, signal }) => {
      send({ type: 'terminal:exit', exitCode, signal });
      try {
        ws.close(1000, 'Shell exited');
      } catch {
        /* ignore */
      }
    });

    const unsubscribeWarn = terminalService.onIdleWarning(sessionId, (secondsLeft) => {
      send({ type: 'terminal:idle-warning', secondsLeft });
    });

    send({
      type: 'terminal:attached',
      shell: info.shell,
      pid: info.pid,
      created_at: info.created_at,
      cols: info.cols,
      rows: info.rows,
      idle_remaining_ms: info.idle_remaining_ms,
    });

    ws.on('message', (raw: Buffer | string) => {
      let parsed: any;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return; // invalid JSON, ignore
      }
      try {
        switch (parsed?.type) {
          case 'terminal:input':
            if (typeof parsed.data === 'string') terminalService.writeData(sessionId, parsed.data);
            break;
          case 'terminal:resize':
            terminalService.resize(sessionId, Number(parsed.cols), Number(parsed.rows));
            break;
          case 'terminal:replay':
            send({ type: 'terminal:replay', data: terminalService.getReplayBuffer(sessionId) });
            break;
          case 'terminal:ping':
            send({ type: 'terminal:pong' });
            break;
          default:
            break;
        }
      } catch (err: any) {
        send({ type: 'terminal:error', message: err?.message || String(err) });
      }
    });

    const cleanup = () => {
      unsubscribeData();
      unsubscribeExit();
      unsubscribeWarn();
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  } catch (error) {
    try {
      ws.close(1011, String(error));
    } catch {
      /* ignore */
    }
  }
}
