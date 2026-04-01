import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { UpdateService } from '../services/updateService';

export function createUpdatesRouter(updateService: UpdateService): Router {
  const router = Router();

  // Check for updates (fetches from GitHub)
  router.get('/check', async (req: AuthRequest, res: Response) => {
    try {
      const updateInfo = await updateService.checkForUpdates();
      res.json(updateInfo);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Get cached status (no network call — fast)
  router.get('/status', async (req: AuthRequest, res: Response) => {
    try {
      const cached = updateService.getLastCheckResult();
      const version = await updateService.getCurrentVersion();
      res.json({
        currentVersion: version,
        hasUpdate: cached?.hasUpdate || false,
        latestVersion: cached?.latestVersion || version,
        lastChecked: updateService.getLastCheckTime(),
        commits: cached?.commits || [],
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Get current version
  router.get('/current', async (req: AuthRequest, res: Response) => {
    try {
      const version = await updateService.getCurrentVersion();
      res.json({ version });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Apply update (git pull + rebuild + restart)
  router.post('/apply', async (req: AuthRequest, res: Response) => {
    try {
      const update = await updateService.applyUpdate();
      res.json(update);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Update history
  router.get('/history', (req: AuthRequest, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const history = updateService.getHistory(limit);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
