import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { ShareService } from '../services/shareService';

export function createSharesRouter(shareService: ShareService): Router {
  const router = Router();

  // ═══════════════════════════════════════════
  // Samba Status
  // ═══════════════════════════════════════════

  // GET /api/shares/status
  router.get('/status', async (req: AuthRequest, res: Response) => {
    try {
      const status = await shareService.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/shares/start
  router.post('/start', async (req: AuthRequest, res: Response) => {
    try {
      await shareService.startSamba();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/shares/stop
  router.post('/stop', async (req: AuthRequest, res: Response) => {
    try {
      await shareService.stopSamba();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/shares/restart
  router.post('/restart', async (req: AuthRequest, res: Response) => {
    try {
      await shareService.restartSamba();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/shares/connections
  router.get('/connections', async (req: AuthRequest, res: Response) => {
    try {
      const connections = await shareService.getConnections();
      res.json(connections);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/shares/open-files
  router.get('/open-files', async (req: AuthRequest, res: Response) => {
    try {
      const files = await shareService.getOpenFiles();
      res.json(files);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ═══════════════════════════════════════════
  // User Management
  // ═══════════════════════════════════════════

  // GET /api/shares/users
  router.get('/users', async (req: AuthRequest, res: Response) => {
    try {
      const users = shareService.getUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/shares/users — create user
  router.post('/users', async (req: AuthRequest, res: Response) => {
    try {
      const { username, password, homeDir } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'username and password are required' });
      }
      const user = await shareService.createUser(username, password, homeDir);
      res.json(user);
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // PUT /api/shares/users/:username/password — update password
  router.put('/users/:username/password', async (req: AuthRequest, res: Response) => {
    try {
      const { password } = req.body;
      if (!password) return res.status(400).json({ error: 'password is required' });
      await shareService.updateUserPassword(req.params.username, password);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // PUT /api/shares/users/:username/toggle — enable/disable
  router.put('/users/:username/toggle', async (req: AuthRequest, res: Response) => {
    try {
      const { enabled } = req.body;
      await shareService.toggleUser(req.params.username, !!enabled);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // DELETE /api/shares/users/:username — delete user
  router.delete('/users/:username', async (req: AuthRequest, res: Response) => {
    try {
      await shareService.deleteUser(req.params.username);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // ═══════════════════════════════════════════
  // Share Management
  // ═══════════════════════════════════════════

  // GET /api/shares/list
  router.get('/list', async (req: AuthRequest, res: Response) => {
    try {
      const shares = shareService.getShares();
      res.json(shares);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/shares/create — create share
  router.post('/create', async (req: AuthRequest, res: Response) => {
    try {
      const { name, path, comment, browseable, readOnly, guestOk, validUsers, writableUsers } = req.body;
      if (!name || !path) return res.status(400).json({ error: 'name and path are required' });
      const share = await shareService.createShare({
        name, path, comment, browseable, readOnly, guestOk, validUsers, writableUsers,
      });
      res.json(share);
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // PUT /api/shares/:name — update share
  router.put('/:name', async (req: AuthRequest, res: Response) => {
    try {
      const share = await shareService.updateShare(req.params.name, req.body);
      res.json(share);
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // DELETE /api/shares/:name — delete share
  router.delete('/:name', async (req: AuthRequest, res: Response) => {
    try {
      await shareService.deleteShare(req.params.name);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  return router;
}
