import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer, WebSocket } from 'ws';
import Database from 'better-sqlite3';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';

import { DEFAULT_CONFIG } from './config/default';
import { SettingsModel } from './models/settings';
import { authMiddleware, optionalAuthMiddleware, createToken } from './middleware/auth';

import { SystemMonitor } from './services/systemMonitor';
import { EventLogger } from './services/eventLogger';
import { DockerService } from './services/dockerService';
import { TerminalService } from './services/terminalService';
import { DatabaseService } from './services/databaseService';
import { MayaService } from './services/mayaService';
import { UpdateService } from './services/updateService';

import { createSystemRouter } from './routes/system';
import { createDockerRouter } from './routes/docker';
import { createSettingsRouter } from './routes/settings';
import { createLogsRouter } from './routes/logs';
import { createDatabaseRouter } from './routes/database';
import { createMayaRouter } from './routes/maya';
import { createUpdatesRouter } from './routes/updates';
import { createTerminalRouter, setupTerminalWebSocket } from './routes/terminal';
import { MysqlService } from './services/mysqlService';
import { createMysqlRouter } from './routes/mysql';
import { AppTemplatesService } from './services/appTemplates';
import { createAppsRouter } from './routes/apps';

// Ensure database directory exists
const dbDir = path.dirname(DEFAULT_CONFIG.DATABASE.PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Ensure log directory exists
const logDir = path.dirname(DEFAULT_CONFIG.LOGGING.FILE_PATH);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Initialize database
const db = new Database(DEFAULT_CONFIG.DATABASE.PATH);
db.pragma('journal_mode = WAL');

// Initialize services
const logger = new EventLogger(db);
const settingsModel = new SettingsModel(db);
const dockerService = new DockerService(DEFAULT_CONFIG.DOCKER.SOCKET, logger);
const terminalService = new TerminalService(logger);
const databaseService = new DatabaseService(db, logger);
const mayaService = new MayaService(db, logger);
const systemMonitor = new SystemMonitor(new WebSocketServer({ noServer: true }), logger);
const updateService = new UpdateService(db, logger, process.cwd(), DEFAULT_CONFIG.GIT.REPO_URL);
const mysqlService = new MysqlService(DEFAULT_CONFIG.DOCKER.SOCKET, logger, dockerService);
const appTemplatesService = new AppTemplatesService();

// Set MySQL root password from settings if configured
const mysqlRootPassword = settingsModel.get('mysql.root_password');
if (mysqlRootPassword) {
  mysqlService.setRootPassword(mysqlRootPassword);
}

// Set Maya dependencies
mayaService.setDependencies(systemMonitor, dockerService);

// Create Express app
const app: Express = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(helmet());
app.use(cors({ origin: DEFAULT_CONFIG.SERVER.FRONTEND_URL }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request logging
app.use((req: Request, res: Response, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.debug('SYSTEM', `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Auth: Login endpoint
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ message: 'Username and password are required' });
    return;
  }

  // Check credentials against settings DB (default: admin/trakend)
  const storedUser = settingsModel.get('auth.username') || 'admin';
  const storedHash = settingsModel.get('auth.password_hash');

  // For first run or default, accept admin/trakend
  const bcrypt = require('bcryptjs');
  let valid = false;
  if (storedHash) {
    valid = username === storedUser && bcrypt.compareSync(password, storedHash);
  } else {
    // Default credentials on first run
    valid = username === 'admin' && password === 'trakend';
    if (valid) {
      // Store hashed default password for future logins
      const hash = bcrypt.hashSync('trakend', 10);
      settingsModel.set('auth.username', 'admin');
      settingsModel.set('auth.password_hash', hash);
    }
  }

  if (!valid) {
    logger.warn('SECURITY', `Failed login attempt for user: ${username}`);
    res.status(401).json({ message: 'Invalid username or password' });
    return;
  }

  const token = createToken('user-1', username, 'admin');
  logger.info('SECURITY', `User '${username}' logged in successfully`);
  res.json({ token, user: { id: 'user-1', username, role: 'admin' } });
});

// Auth: Verify token
app.post('/api/auth/verify', authMiddleware, (req: Request, res: Response) => {
  res.json({ valid: true, user: (req as any).user });
});

// Auth: Change password
app.post('/api/auth/change-password', authMiddleware, (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  const bcrypt = require('bcryptjs');
  const storedHash = settingsModel.get('auth.password_hash');

  if (storedHash && !bcrypt.compareSync(currentPassword, storedHash)) {
    res.status(401).json({ message: 'Current password is incorrect' });
    return;
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  settingsModel.set('auth.password_hash', newHash);
  logger.info('SECURITY', 'Password changed successfully');
  res.json({ message: 'Password updated successfully' });
});

// API Routes with auth middleware
app.use('/api/system', authMiddleware, createSystemRouter(systemMonitor));
app.use('/api/docker', authMiddleware, createDockerRouter(dockerService));
app.use('/api/settings', authMiddleware, createSettingsRouter(settingsModel));
app.use('/api/logs', authMiddleware, createLogsRouter(logger));
app.use('/api/database', authMiddleware, createDatabaseRouter(databaseService));
app.use('/api/maya', authMiddleware, createMayaRouter(mayaService));
app.use('/api/updates', authMiddleware, createUpdatesRouter(updateService));
app.use('/api/terminal', authMiddleware, createTerminalRouter(terminalService));
app.use('/api/mysql', authMiddleware, createMysqlRouter(mysqlService));
app.use('/api/apps', authMiddleware, createAppsRouter(dockerService, appTemplatesService, logger));

// WebSocket server for real-time updates
wss.on('connection', (ws: WebSocket, req) => {
  const url = req.url || '';
  logger.debug('SYSTEM', `WebSocket connection: ${url}`);

  // System stats stream
  if (url.startsWith('/ws/stats')) {
    systemMonitor.registerClient(ws);
  }
  // Terminal stream
  else if (url.startsWith('/ws/terminal/')) {
    const sessionId = url.split('/').pop();
    if (sessionId) {
      setupTerminalWebSocket(ws, sessionId, terminalService);
    }
  }
  // Logs stream
  else if (url.startsWith('/ws/logs')) {
    // Send existing logs
    const logs = logger.getLogs({ limit: 50 });
    ws.send(
      JSON.stringify({
        type: 'logs:batch',
        data: logs,
      })
    );

    // Note: In production, implement actual log streaming
  }

  ws.on('error', (error) => {
    logger.error('SYSTEM', `WebSocket error: ${error}`);
  });

  ws.on('close', () => {
    logger.debug('SYSTEM', 'WebSocket connection closed');
  });
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Error handling middleware
app.use((error: any, req: Request, res: Response) => {
  logger.error('SYSTEM', `Server error: ${error.message}`);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SYSTEM', 'SIGTERM received, shutting down gracefully...');
  systemMonitor.stop();
  updateService.stopDailyCheck();
  terminalService.closeAllSessions();
  await mysqlService.closeConnection();
  server.close(() => {
    logger.info('SYSTEM', 'Server closed');
    db.close();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SYSTEM', 'SIGINT received, shutting down gracefully...');
  systemMonitor.stop();
  updateService.stopDailyCheck();
  terminalService.closeAllSessions();
  await mysqlService.closeConnection();
  server.close(() => {
    logger.info('SYSTEM', 'Server closed');
    db.close();
    process.exit(0);
  });
});

// Start server
const start = async () => {
  try {
    // Initialize system monitor
    systemMonitor.start();
    logger.info('SYSTEM', 'System monitor started');

    // Log initial system info
    const overview = await systemMonitor.getOverview();
    logger.info('SYSTEM', 'System initialized', {
      os: overview.osInfo.distro,
      kernel: overview.osInfo.kernel,
      cpuCores: overview.cpu.cores,
      totalMemory: overview.memory.total,
    });

    // Auto-start MariaDB on server boot
    try {
      await mysqlService.ensureMariaDBRunning();
      logger.info('SYSTEM', 'MariaDB service initialized and running');
    } catch (error) {
      logger.warn('SYSTEM', `MariaDB initialization failed (will retry on demand): ${error}`);
    }

    // Start daily update check — connects to joeabillion/TRAKENDOS repo
    updateService.setMayaService(mayaService);
    updateService.startDailyCheck(DEFAULT_CONFIG.GIT.CHECK_INTERVAL_HOURS);
    logger.info('SYSTEM', `Daily update check started (every ${DEFAULT_CONFIG.GIT.CHECK_INTERVAL_HOURS}h from ${DEFAULT_CONFIG.GIT.REPO_URL})`);

    // Start server
    server.listen(DEFAULT_CONFIG.SERVER.PORT, DEFAULT_CONFIG.SERVER.HOST, () => {
      logger.info('SYSTEM', `Trakend OS Backend started on ${DEFAULT_CONFIG.SERVER.HOST}:${DEFAULT_CONFIG.SERVER.PORT}`);
      console.log(`Server listening on ${DEFAULT_CONFIG.SERVER.HOST}:${DEFAULT_CONFIG.SERVER.PORT}`);
    });
  } catch (error) {
    logger.critical('SYSTEM', `Failed to start server: ${error}`);
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();

// Export for testing
export { app, server, db, logger };
