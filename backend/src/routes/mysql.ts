import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { MysqlService } from '../services/mysqlService';

export function createMysqlRouter(mysqlService: MysqlService): Router {
  const router = Router();

  // Status endpoints
  router.get('/status', async (req: AuthRequest, res: Response) => {
    try {
      const status = await mysqlService.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/start', async (req: AuthRequest, res: Response) => {
    try {
      await mysqlService.startContainer();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/stop', async (req: AuthRequest, res: Response) => {
    try {
      await mysqlService.stopContainer();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/restart', async (req: AuthRequest, res: Response) => {
    try {
      await mysqlService.restartContainer();
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Database endpoints
  router.get('/databases', async (req: AuthRequest, res: Response) => {
    try {
      const databases = await mysqlService.listDatabases();
      res.json(databases);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/databases', async (req: AuthRequest, res: Response) => {
    try {
      const { name, charset, collation } = req.body;
      if (!name) {
        res.status(400).json({ error: 'Database name required' });
        return;
      }
      await mysqlService.createDatabase(name, charset, collation);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/databases/:name', async (req: AuthRequest, res: Response) => {
    try {
      await mysqlService.dropDatabase(req.params.name);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Table endpoints
  router.get('/databases/:db/tables', async (req: AuthRequest, res: Response) => {
    try {
      const tables = await mysqlService.listTables(req.params.db);
      res.json(tables);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/databases/:db/tables/:table', async (req: AuthRequest, res: Response) => {
    try {
      const schema = await mysqlService.getTableSchema(req.params.db, req.params.table);
      res.json(schema);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Query endpoint
  router.post('/query', async (req: AuthRequest, res: Response) => {
    try {
      const { database, sql } = req.body;
      if (!database || !sql) {
        res.status(400).json({ error: 'Database and SQL required' });
        return;
      }
      const result = await mysqlService.query(database, sql);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // User endpoints
  router.get('/users', async (req: AuthRequest, res: Response) => {
    try {
      const users = await mysqlService.listUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/users', async (req: AuthRequest, res: Response) => {
    try {
      const { user, host, password } = req.body;
      if (!user || !host || !password) {
        res.status(400).json({ error: 'User, host, and password required' });
        return;
      }
      await mysqlService.createUser(user, host, password);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/users/:user', async (req: AuthRequest, res: Response) => {
    try {
      const { host } = req.body;
      if (!host) {
        res.status(400).json({ error: 'Host required' });
        return;
      }
      await mysqlService.dropUser(req.params.user, host);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/users/:user/grant', async (req: AuthRequest, res: Response) => {
    try {
      const { host, privileges, database, table } = req.body;
      if (!host || !privileges) {
        res.status(400).json({ error: 'Host and privileges required' });
        return;
      }
      await mysqlService.grantPrivileges(req.params.user, host, privileges, database, table);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/users/:user/grants', async (req: AuthRequest, res: Response) => {
    try {
      const { host } = req.query;
      if (!host) {
        res.status(400).json({ error: 'Host required' });
        return;
      }
      const grants = await mysqlService.showGrants(req.params.user, host as string);
      res.json(grants);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Process endpoints
  router.get('/processes', async (req: AuthRequest, res: Response) => {
    try {
      const processes = await mysqlService.getProcessList();
      res.json(processes);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/processes/:id/kill', async (req: AuthRequest, res: Response) => {
    try {
      const processId = parseInt(req.params.id, 10);
      await mysqlService.killQuery(processId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Export/Import endpoints
  router.post('/export/:db', async (req: AuthRequest, res: Response) => {
    try {
      const sqlContent = await mysqlService.exportDatabase(req.params.db);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.db}_$(Date.now()).sql"`);
      res.send(sqlContent);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/import/:db', async (req: AuthRequest, res: Response) => {
    try {
      const { sqlContent } = req.body;
      if (!sqlContent) {
        res.status(400).json({ error: 'SQL content required' });
        return;
      }
      await mysqlService.importDatabase(req.params.db, sqlContent);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
