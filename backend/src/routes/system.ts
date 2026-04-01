import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { SystemMonitor } from '../services/systemMonitor';

export function createSystemRouter(systemMonitor: SystemMonitor): Router {
  const router = Router();

  router.get('/overview', async (req: AuthRequest, res: Response) => {
    try {
      const overview = await systemMonitor.getOverview();
      res.json(overview);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/cpu', async (req: AuthRequest, res: Response) => {
    try {
      const cpuUsage = await systemMonitor.getCPUDetailed();
      res.json(cpuUsage);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/memory', async (req: AuthRequest, res: Response) => {
    try {
      const memory = await systemMonitor.getMemoryDetailed();
      res.json(memory);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/disks', async (req: AuthRequest, res: Response) => {
    try {
      const disks = await systemMonitor.getDisksDetailed();
      res.json(disks);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/network', async (req: AuthRequest, res: Response) => {
    try {
      const network = await systemMonitor.getNetworkDetailed();
      res.json(network);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
