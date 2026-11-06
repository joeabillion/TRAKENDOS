import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { UpdateService } from '../services/updateService';

export function createUpdatesRouter(updateService: UpdateService): Router {
  const router = Router();

  // Check for updates (fetches from the git remote)
  router.get('/check', async (req: AuthRequest, res: Response) => {
    try {
      const updateInfo = await updateService.checkForUpdates();
      res.json(updateInfo);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Get cached status (no network call — fast).
  // Returns: isGitRepo, currentHash, currentBranch, lastCheck, updateAvailable,
  // commitsBehind, lastUpdate (latest history row) + extras.
  router.get('/status', async (req: AuthRequest, res: Response) => {
    try {
      const status = await updateService.getStatus();
      res.json({
        ...status,
        // Backwards-compatible aliases used by older UI builds
        hasUpdate: status.updateAvailable,
        lastChecked: status.lastCheck,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Get current version
  router.get('/current', async (req: AuthRequest, res: Response) => {
    try {
      const version = await updateService.getCurrentVersion();
      res.json({ version, hash: updateService.getCurrentHash(), branch: updateService.getCurrentBranch() });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Apply update (git pull --ff-only + rebuild + verified restart; rolls back on failure)
  router.post('/apply', async (req: AuthRequest, res: Response) => {
    try {
      const update = await updateService.applyUpdate();
      res.json(update);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const code = /already in progress/i.test(msg) ? 409 : /No update available/i.test(msg) ? 400 : 500;
      res.status(code).json({ error: msg });
    }
  });

  // Bootstrap a git checkout in a non-repo install (ISO installs shipped without .git)
  router.post('/init-repo', async (req: AuthRequest, res: Response) => {
    try {
      const branch = typeof req.body?.branch === 'string' && req.body.branch.trim() ? req.body.branch.trim() : 'server-live';
      const result = await updateService.initRepo(branch);
      res.json({ success: true, ...result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(/already initialized/i.test(msg) ? 409 : 500).json({ error: msg });
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
