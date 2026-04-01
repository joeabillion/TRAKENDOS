# Trakend OS Backend Architecture

## Overview

The Trakend OS Backend is a comprehensive server management system built with Node.js, TypeScript, and Express.js. It provides real-time system monitoring, Docker management, terminal access, and AI-assisted system optimization through the Maya service.

## Directory Structure

```
backend/
├── src/
│   ├── config/
│   │   └── default.ts                 # Configuration and constants
│   ├── middleware/
│   │   └── auth.ts                    # JWT authentication
│   ├── models/
│   │   └── settings.ts                # Settings data model
│   ├── routes/
│   │   ├── system.ts                  # System info routes
│   │   ├── docker.ts                  # Docker management routes
│   │   ├── terminal.ts                # Terminal session routes
│   │   ├── settings.ts                # Settings routes
│   │   ├── logs.ts                    # Logging routes
│   │   ├── database.ts                # Database management routes
│   │   ├── maya.ts                    # Maya AI routes
│   │   └── updates.ts                 # Update management routes
│   ├── services/
│   │   ├── systemMonitor.ts           # System monitoring service
│   │   ├── dockerService.ts           # Docker API wrapper
│   │   ├── terminalService.ts         # PTY terminal manager
│   │   ├── eventLogger.ts             # Event logging service
│   │   ├── databaseService.ts         # SQLite operations
│   │   ├── mayaService.ts             # AI assistant service
│   │   └── updateService.ts           # Git-based updates
│   └── index.ts                       # Main server entry point
├── package.json                       # Dependencies
├── tsconfig.json                      # TypeScript configuration
├── .env.example                       # Environment template
├── README.md                          # API documentation
└── ARCHITECTURE.md                    # This file
```

## Core Services

### SystemMonitor
Provides real-time system statistics via the `systeminformation` library.

**Key Features:**
- CPU usage with per-core breakdown
- Memory and RAM statistics
- Disk information with SMART data enrichment
- GPU information
- Network interface statistics
- 5-minute history for sparkline charts
- WebSocket broadcasting (2-second intervals)

**Files:**
- `/src/services/systemMonitor.ts`
- Routes: `/src/routes/system.ts`

### EventLogger
Comprehensive event logging with automatic pattern detection.

**Key Features:**
- Five severity levels: DEBUG, INFO, WARN, ERROR, CRITICAL
- Seven log sources: SYSTEM, DOCKER, MAYA, USER, NETWORK, DISK, SECURITY
- Automatic pattern detection (high CPU, low memory, disk space, etc.)
- 30-day retention with automatic cleanup
- CSV export capability
- Filtering and search

**Files:**
- `/src/services/eventLogger.ts`
- Routes: `/src/routes/logs.ts`

### DockerService
Wraps the dockerode library for complete container lifecycle management.

**Key Features:**
- List containers with detailed information
- Get live stats (CPU, memory, network I/O)
- Retrieve logs with customizable tail
- Start, stop, restart, remove containers
- Update container settings (memory, CPU limits)
- Image management (list, pull, remove)
- Network and volume listing

**Files:**
- `/src/services/dockerService.ts`
- Routes: `/src/routes/docker.ts`

### TerminalService
Manages multiple concurrent PTY terminal sessions using node-pty.

**Key Features:**
- Multiple concurrent terminal sessions
- Real PTY emulation (not emulated shells)
- Dynamic resizing support
- Automatic cleanup after 30 minutes of inactivity
- WebSocket streaming support

**Files:**
- `/src/services/terminalService.ts`
- Routes: `/src/routes/terminal.ts`

### DatabaseService
SQLite database operations with safety checks.

**Key Features:**
- Query execution with read-only validation
- Table management (create, drop, inspect)
- Schema introspection
- Database export/import
- Statistics (table count, row count, size)

**Files:**
- `/src/services/databaseService.ts`
- Routes: `/src/routes/database.ts`

### MayaService
Rule-based AI assistant for system health analysis and optimization.

**Key Features:**
- System health investigation
- Auto-repair recommendations
- Optimization suggestions
- Full system scanning
- Duplicate file detection
- Notification system
- Chat interface with context-aware responses
- Dos and Don'ts knowledge base
- Action history tracking

**Files:**
- `/src/services/mayaService.ts`
- Routes: `/src/routes/maya.ts`

### UpdateService
Git-based update management for the entire system.

**Key Features:**
- Check for updates from remote repository
- Compare versions
- Apply updates via git pull
- Automatic server restart
- Update history tracking
- Changelog generation

**Files:**
- `/src/services/updateService.ts`
- Routes: `/src/routes/updates.ts`

### SettingsModel
Persistent application settings using SQLite.

**Categories:**
- SSH configuration
- Docker daemon settings
- Theme preferences
- General system settings
- Maya AI configuration
- Update preferences

**Files:**
- `/src/models/settings.ts`
- Routes: `/src/routes/settings.ts`

## Authentication & Security

### JWT Authentication
Token-based authentication for all API endpoints (except /health and /auth/verify).

**Features:**
- Bearer token in Authorization header
- Configurable expiry (default: 24h)
- Role-based access control support
- Optional authentication for certain endpoints

**Files:**
- `/src/middleware/auth.ts`

**Implementation Details:**
- Token creation: `createToken(userId, username, role)`
- Token verification: `verifyToken(token)`
- Middleware: `authMiddleware`, `optionalAuthMiddleware`

### Security Headers
- Helmet.js for HTTP security headers
- CORS configuration for frontend URL
- Request size limits (50MB)

## Database Schema

### Tables

**settings**
```sql
CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**event_logs**
```sql
CREATE TABLE event_logs (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  pattern_detected TEXT,
  created_at INTEGER NOT NULL
);
```

**maya_notifications**
```sql
CREATE TABLE maya_notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL,
  dismissed INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  action_type TEXT,
  action_target TEXT
);
```

**maya_actions**
```sql
CREATE TABLE maya_actions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  target TEXT,
  findings TEXT,
  actions_taken TEXT,
  result TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT
);
```

**update_history**
```sql
CREATE TABLE update_history (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  from_version TEXT NOT NULL,
  status TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  completed_at INTEGER,
  error TEXT,
  changelog TEXT
);
```

## WebSocket Protocol

### System Stats Stream
**Endpoint:** `ws://localhost:3001/ws/stats`

**Message Format:**
```json
{
  "type": "system:stats",
  "data": {
    "cpu": {...},
    "cpuUsage": {...},
    "memory": {...},
    "disks": [...],
    "gpus": [...],
    "networkInterfaces": [...],
    "osInfo": {...},
    "uptime": 12345,
    "timestamp": 1234567890
  }
}
```

### Terminal Stream
**Endpoint:** `ws://localhost:3001/ws/terminal/:sessionId`

**Client to Server:**
```json
{
  "type": "terminal:input",
  "data": "command text"
}
```

**Server to Client:**
```json
{
  "type": "terminal:data",
  "sessionId": "session-id",
  "data": "output text"
}
```

### Logs Stream
**Endpoint:** `ws://localhost:3001/ws/logs`

**Message Format:**
```json
{
  "type": "logs:batch",
  "data": [...]
}
```

## API Response Format

All API responses follow a consistent format:

**Success:**
```json
{
  "data": {...} or [...]
}
```

**Error:**
```json
{
  "error": "Error message"
}
```

## Error Handling

- All routes have try-catch blocks
- Errors are logged with context
- HTTP status codes are appropriate
- Stack traces in logs for debugging

## Performance Optimizations

1. **Database**: WAL mode for concurrent access
2. **System Stats**: 2-second broadcast interval
3. **CPU History**: Limited to 5 minutes (150 samples)
4. **Event Logs**: Auto-cleanup after 30 days
5. **Terminal Sessions**: Auto-cleanup after 30 minutes inactivity
6. **WebSocket**: Efficient binary encoding for stats

## Deployment Considerations

### Requirements
- Node.js 16+
- Docker daemon access
- Git installation
- Write access to `/var/lib/trakend-os/` and `/var/log/trakend-os/`

### Environment Variables
See `.env.example` for all configurable options.

### Systemd Service Example
```ini
[Unit]
Description=Trakend OS Backend
After=docker.service

[Service]
Type=simple
User=trakend
WorkingDirectory=/opt/trakend-os/backend
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

## Development Workflow

1. Clone repository
2. `npm install`
3. `npm run dev` (with ts-node)
4. Make changes (TypeScript auto-compiles)
5. Test endpoints
6. `npm run build` before deployment

## Logging

Winston logger with levels: DEBUG, INFO, WARN, ERROR, CRITICAL

All events logged to:
- SQLite database (event_logs table)
- File system (LOG_FILE path)
- Console (during development)

## Future Enhancements

- Ollama integration for advanced Maya AI
- Prometheus metrics export
- InfluxDB time-series storage
- Multi-user authentication
- Role-based access control (RBAC)
- API rate limiting
- Request/response caching
- Advanced RAID monitoring
- Email/Slack notifications
- Custom alert rules
- Backup scheduling
