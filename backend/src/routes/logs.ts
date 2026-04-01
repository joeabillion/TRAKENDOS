import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { EventLogger } from '../services/eventLogger';
import { SeverityLevel, LogSource } from '../config/default';

export function createLogsRouter(logger: EventLogger): Router {
  const router = Router();

  router.get('/', (req: AuthRequest, res: Response) => {
    try {
      const filters = {
        level: (req.query.level as SeverityLevel) || undefined,
        source: (req.query.source as LogSource) || undefined,
        startTime: req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined,
        endTime: req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined,
        search: (req.query.search as string) || undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 100,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : 0,
      };

      const logs = logger.getLogs(filters);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/stats', (req: AuthRequest, res: Response) => {
    try {
      const stats = logger.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/clear', (req: AuthRequest, res: Response) => {
    try {
      const daysOld = req.body.daysOld || 30;
      const deletedCount = logger.clearOldLogs(daysOld);
      res.json({ deletedCount });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/export', (req: AuthRequest, res: Response) => {
    try {
      const csv = logger.export({
        level: (req.query.level as SeverityLevel) || undefined,
        source: (req.query.source as LogSource) || undefined,
        startTime: req.query.startTime ? parseInt(req.query.startTime as string, 10) : undefined,
        endTime: req.query.endTime ? parseInt(req.query.endTime as string, 10) : undefined,
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="logs.csv"');
      res.send(csv);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
