import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { TerminalService } from '../services/terminalService';
import { WebSocket } from 'ws';

interface TerminalRequest extends AuthRequest {
  ws?: WebSocket;
  sessionId?: string;
}

export function createTerminalRouter(terminalService: TerminalService): Router {
  const router = Router();

  router.post('/sessions', (req: AuthRequest, res: Response) => {
    try {
      const name = req.body.name || undefined;
      const session = terminalService.createSession(name);
      res.json(session);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/sessions', (req: AuthRequest, res: Response) => {
    try {
      const sessions = terminalService.getSessions();
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/sessions/:id', (req: AuthRequest, res: Response) => {
    try {
      terminalService.closeSession(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}

export function setupTerminalWebSocket(ws: WebSocket, sessionId: string, terminalService: TerminalService): void {
  try {
    const unsubscribe = terminalService.onData(sessionId, (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'terminal:data',
            sessionId,
            data,
          })
        );
      }
    });

    ws.on('message', (message: string) => {
      try {
        const parsed = JSON.parse(message);

        if (parsed.type === 'terminal:input') {
          terminalService.writeData(sessionId, parsed.data);
        } else if (parsed.type === 'terminal:resize') {
          terminalService.resize(sessionId, parsed.cols, parsed.rows);
        }
      } catch {
        // Invalid message, ignore
      }
    });

    ws.on('close', () => {
      unsubscribe();
    });

    ws.on('error', () => {
      unsubscribe();
    });
  } catch (error) {
    ws.close(1011, String(error));
  }
}
