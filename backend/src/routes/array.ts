import { Router, Request, Response } from 'express';
import { ArrayService, DriveRole, ArrayMode } from '../services/arrayService';

export function createArrayRoutes(arrayService: ArrayService): Router {
  const router = Router();

  // ──────────────────────────────────────────────────────
  // Array status and config
  // ──────────────────────────────────────────────────────

  // GET /api/array/summary — Full array overview
  router.get('/summary', async (_req: Request, res: Response) => {
    try {
      const summary = arrayService.getArraySummary();
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/array/config — Array configuration
  router.get('/config', (_req: Request, res: Response) => {
    try {
      res.json(arrayService.getArrayConfig());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/array/config — Update array configuration
  router.put('/config', (req: Request, res: Response) => {
    try {
      const config = arrayService.updateArrayConfig(req.body);
      res.json(config);
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // ──────────────────────────────────────────────────────
  // Array start/stop
  // ──────────────────────────────────────────────────────

  // POST /api/array/start
  router.post('/start', async (_req: Request, res: Response) => {
    try {
      await arrayService.startArray();
      res.json({ status: 'started', config: arrayService.getArrayConfig() });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // POST /api/array/stop
  router.post('/stop', async (_req: Request, res: Response) => {
    try {
      await arrayService.stopArray();
      res.json({ status: 'stopped' });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // ──────────────────────────────────────────────────────
  // Drive management
  // ──────────────────────────────────────────────────────

  // GET /api/array/drives — Scan and list all physical drives
  router.get('/drives', async (_req: Request, res: Response) => {
    try {
      const drives = await arrayService.scanDrives();
      res.json(drives);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/array/drives/scan — Force re-scan
  router.post('/drives/scan', async (_req: Request, res: Response) => {
    try {
      const drives = await arrayService.scanDrives();
      res.json({ count: drives.length, drives });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/array/drives/assigned — List assigned drives
  router.get('/drives/assigned', (_req: Request, res: Response) => {
    try {
      const assigned = arrayService.getAssignedDrives();
      res.json(assigned);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/array/drives/assign — Assign a drive to a role
  router.post('/drives/assign', async (req: Request, res: Response) => {
    try {
      const { driveId, role, slot } = req.body as { driveId: string; role: DriveRole; slot?: number };
      if (!driveId || !role) {
        return res.status(400).json({ error: 'driveId and role are required' });
      }
      await arrayService.assignDrive(driveId, role, slot);
      res.json({ status: 'assigned', driveId, role, slot });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // POST /api/array/drives/unassign — Remove a drive from the array
  router.post('/drives/unassign', async (req: Request, res: Response) => {
    try {
      const { driveId } = req.body as { driveId: string };
      if (!driveId) return res.status(400).json({ error: 'driveId is required' });
      await arrayService.unassignDrive(driveId);
      res.json({ status: 'unassigned', driveId });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // GET /api/array/drives/:serial/smart-history — SMART history for a drive
  router.get('/drives/:serial/smart-history', (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const history = arrayService.getSmartHistory(req.params.serial, limit);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ──────────────────────────────────────────────────────
  // Parity operations
  // ──────────────────────────────────────────────────────

  // GET /api/array/parity/status — Current parity operation status
  router.get('/parity/status', (_req: Request, res: Response) => {
    try {
      const status = arrayService.getParityStatus();
      res.json(status || { status: 'idle' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/array/parity/sync — Start parity sync (initial build)
  router.post('/parity/sync', async (_req: Request, res: Response) => {
    try {
      const op = await arrayService.startParitySync();
      res.json(op);
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // POST /api/array/parity/check — Start parity check
  router.post('/parity/check', async (req: Request, res: Response) => {
    try {
      const correct = req.body?.correct === true;
      const op = await arrayService.startParityCheck(correct);
      res.json(op);
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // POST /api/array/parity/rebuild — Start drive rebuild from parity
  router.post('/parity/rebuild', async (req: Request, res: Response) => {
    try {
      const { driveId } = req.body as { driveId: string };
      if (!driveId) return res.status(400).json({ error: 'driveId is required' });
      const op = await arrayService.startDriveRebuild(driveId);
      res.json(op);
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // POST /api/array/parity/cancel — Cancel running parity operation
  router.post('/parity/cancel', (_req: Request, res: Response) => {
    try {
      arrayService.cancelParityOperation();
      res.json({ status: 'cancelled' });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // GET /api/array/parity/history — Parity operation history
  router.get('/parity/history', (_req: Request, res: Response) => {
    try {
      const history = arrayService.getParityHistory();
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ──────────────────────────────────────────────────────
  // Shares
  // ──────────────────────────────────────────────────────

  // GET /api/array/shares
  router.get('/shares', (_req: Request, res: Response) => {
    try {
      res.json(arrayService.getShares());
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/array/shares
  router.post('/shares', (req: Request, res: Response) => {
    try {
      const share = arrayService.createShare(req.body);
      res.status(201).json(share);
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // PUT /api/array/shares/:id
  router.put('/shares/:id', (req: Request, res: Response) => {
    try {
      const share = arrayService.updateShare(req.params.id, req.body);
      res.json(share);
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  // DELETE /api/array/shares/:id
  router.delete('/shares/:id', (req: Request, res: Response) => {
    try {
      arrayService.deleteShare(req.params.id);
      res.json({ status: 'deleted' });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  });

  return router;
}
