import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { DatabaseService } from '../services/databaseService';

export function createDatabaseRouter(dbService: DatabaseService): Router {
  const router = Router();

  router.get('/tables', (req: AuthRequest, res: Response) => {
    try {
      const tables = dbService.getTables();
      res.json(tables);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/tables/:name', (req: AuthRequest, res: Response) => {
    try {
      const schema = dbService.getTableSchema(req.params.name);
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
      const data = dbService.getTableData(req.params.name, limit, offset);

      res.json({ schema, data, limit, offset });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/query', (req: AuthRequest, res: Response) => {
    try {
      const { query, params } = req.body;
      if (!query) {
        res.status(400).json({ error: 'query required' });
        return;
      }

      const result = dbService.executeQuery(query, params);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/tables', (req: AuthRequest, res: Response) => {
    try {
      const { name, columns } = req.body;
      if (!name || !columns) {
        res.status(400).json({ error: 'name and columns required' });
        return;
      }

      dbService.createTable(name, columns);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/tables/:name', (req: AuthRequest, res: Response) => {
    try {
      dbService.dropTable(req.params.name);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/export', async (req: AuthRequest, res: Response) => {
    try {
      const data = await dbService.export();
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="database.backup"');
      res.send(Buffer.from(data, 'base64'));
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/import', async (req: AuthRequest, res: Response) => {
    try {
      const { data } = req.body;
      if (!data) {
        res.status(400).json({ error: 'data required' });
        return;
      }

      await dbService.import(data);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/stats', (req: AuthRequest, res: Response) => {
    try {
      const stats = dbService.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
