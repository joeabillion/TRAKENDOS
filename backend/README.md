# Trakend OS Backend

A complete server management backend for Trakend OS - an Unraid-like server management operating system.

## Features

- **System Monitoring**: Real-time CPU, memory, disk, GPU, and network statistics
- **Docker Management**: Complete container lifecycle management with stats and logs
- **Terminal Access**: WebSocket-based terminal emulation with multiple sessions
- **Event Logging**: Comprehensive event logging with pattern detection and filtering
- **Settings Management**: Configurable SSH, Docker, theme, general, Maya, and update settings
- **Database Management**: SQLite database query execution and table management
- **Maya AI Assistant**: Rule-based system health analysis and optimization
- **Git-based Updates**: Check and apply updates from a git repository
- **Authentication**: JWT-based authentication for API endpoints

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Web Framework**: Express.js
- **Real-time Communication**: WebSocket (ws)
- **Docker Interaction**: dockerode
- **System Information**: systeminformation
- **Terminal Emulation**: node-pty
- **Database**: SQLite (better-sqlite3)
- **Logging**: Winston
- **Security**: bcryptjs, jsonwebtoken, helmet
- **Task Scheduling**: node-cron
- **Utilities**: uuid, cors, dotenv

## Installation

### Prerequisites
- Node.js 16+ with npm
- Docker daemon (for Docker features)
- Git (for update features)

### Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Build TypeScript:
```bash
npm run build
```

4. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Environment Variables

```
PORT=3001                              # Server port
HOST=0.0.0.0                          # Server host
FRONTEND_URL=http://localhost:3000    # Frontend URL for CORS
DB_PATH=/var/lib/trakend-os/trakend.db  # Database path
JWT_SECRET=your-secret-key             # JWT signing secret
DOCKER_SOCKET=/var/run/docker.sock    # Docker socket path
LOG_LEVEL=info                         # Logging level
LOG_FILE=/var/log/trakend-os/app.log  # Log file path
MAYA_ENABLED=true                      # Enable Maya AI
OLLAMA_URL=http://localhost:11434     # Ollama API URL
MAYA_MODEL=neural-chat                # Model name
GIT_REPO_URL=https://github.com/...   # Git repository for updates
GIT_BRANCH=main                        # Default git branch
```

## API Endpoints

### System
- `GET /api/system/overview` - System overview
- `GET /api/system/cpu` - CPU details
- `GET /api/system/memory` - Memory details
- `GET /api/system/disks` - Disk information
- `GET /api/system/network` - Network information

### Docker
- `GET /api/docker/containers` - List containers
- `GET /api/docker/containers/:id/stats` - Container stats
- `GET /api/docker/containers/:id/logs` - Container logs
- `POST /api/docker/containers/:id/start` - Start container
- `POST /api/docker/containers/:id/stop` - Stop container
- `POST /api/docker/containers/:id/restart` - Restart container
- `POST /api/docker/containers/:id/remove` - Remove container
- `GET /api/docker/images` - List images
- `POST /api/docker/images/pull` - Pull image
- `DELETE /api/docker/images/:id` - Remove image
- `GET /api/docker/networks` - List networks
- `GET /api/docker/volumes` - List volumes

### Settings
- `GET/PUT /api/settings/ssh` - SSH configuration
- `GET/PUT /api/settings/docker` - Docker settings
- `GET/PUT /api/settings/theme` - Theme settings
- `GET/PUT /api/settings/general` - General settings
- `GET/PUT /api/settings/maya` - Maya settings
- `GET/PUT /api/settings/updates` - Update settings

### Logs
- `GET /api/logs` - Get logs with filtering
- `GET /api/logs/stats` - Log statistics
- `POST /api/logs/clear` - Clear old logs
- `GET /api/logs/export` - Export logs as CSV

### Database
- `GET /api/database/tables` - List tables
- `GET /api/database/tables/:name` - Get table data
- `POST /api/database/query` - Execute query
- `POST /api/database/tables` - Create table
- `DELETE /api/database/tables/:name` - Drop table
- `GET /api/database/export` - Export database
- `POST /api/database/import` - Import database

### Maya
- `GET /api/maya/status` - Maya status
- `POST /api/maya/investigate` - Investigate issue
- `POST /api/maya/repair` - Repair issue
- `POST /api/maya/optimize` - Optimize system
- `POST /api/maya/scan` - Full system scan
- `POST /api/maya/duplicates` - Find duplicates
- `GET /api/maya/notifications` - Get notifications
- `PUT /api/maya/notifications/:id/dismiss` - Dismiss notification
- `GET /api/maya/history` - Action history
- `POST /api/maya/chat` - Chat with Maya

### Updates
- `GET /api/updates/check` - Check for updates
- `GET /api/updates/current` - Current version
- `POST /api/updates/apply` - Apply update
- `GET /api/updates/history` - Update history

### Terminal
- `POST /api/terminal/sessions` - Create session
- `GET /api/terminal/sessions` - List sessions
- `DELETE /api/terminal/sessions/:id` - Close session

## WebSocket Endpoints

- `ws://localhost:3001/ws/stats` - Real-time system statistics
- `ws://localhost:3001/ws/terminal/:sessionId` - Terminal streaming
- `ws://localhost:3001/ws/logs` - Log streaming

## Authentication

The API uses JWT bearer tokens. Include the token in the Authorization header:

```
Authorization: Bearer <token>
```

To get a token, use the auth endpoint:

```bash
curl -X POST http://localhost:3001/auth/verify
```

## Database Schema

The SQLite database includes these tables:

- `settings` - Application settings
- `event_logs` - System event logs
- `maya_notifications` - Maya notifications
- `maya_actions` - Maya action history
- `update_history` - Update history

## Architecture

### Services
- **SystemMonitor**: Real-time system statistics
- **EventLogger**: Event logging with pattern detection
- **DockerService**: Docker API wrapper
- **TerminalService**: PTY terminal session management
- **DatabaseService**: SQLite operations
- **MayaService**: AI-assisted system management
- **UpdateService**: Git-based update management

### Middleware
- **authMiddleware**: JWT authentication enforcement
- **optionalAuthMiddleware**: Optional authentication

### Models
- **SettingsModel**: Settings persistence

## Performance Considerations

- System stats are broadcast every 2 seconds via WebSocket
- CPU usage history maintains 5 minutes of data (150 samples)
- Event logs are retained for 30 days by default
- Database uses WAL mode for better concurrency

## Security Notes

- Change the JWT_SECRET in production
- Use HTTPS in production
- Restrict Docker socket permissions
- Configure CORS appropriately
- Implement proper authentication in production

## License

MIT / Apache 2.0 / BSD (all dependencies are open-source compatible)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

For issues and feature requests, visit the GitHub repository.
