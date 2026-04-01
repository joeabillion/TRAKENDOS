# Trakend OS Frontend

A professional, dark-themed server management UI built with React 18, TypeScript, and TailwindCSS. Inspired by Unraid's UI aesthetic with modern features and real-time system monitoring.

## Features

- **Dashboard**: Real-time system monitoring with CPU, memory, storage, GPU, and network widgets
- **Docker Management**: Container lifecycle management with real-time stats
- **Database UI**: SQL query editor with results table and data import/export
- **Terminal**: Multi-tab xterm.js terminal with full PTY support
- **Logs**: Event logging with filtering, search, and statistics
- **Maya AI**: Intelligent system management assistant with actions and chat interface
- **Settings**: Comprehensive configuration for system, SSH, Docker, theme, and updates
- **Theme System**: Customizable color scheme with presets and real-time preview

## Tech Stack

- **React 18** - Modern UI library
- **TypeScript** - Type safety
- **Vite** - Lightning-fast build tool
- **TailwindCSS** - Utility-first styling
- **xterm.js** - Terminal emulation
- **Recharts** - Data visualization
- **Lucide React** - Icon library
- **Zustand** - State management (via WebSocket context)
- **Axios** - HTTP client

## Quick Start

### Prerequisites

- Node.js 16+ and npm/yarn/pnpm
- Backend running on `http://localhost:3001`

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:5173` with hot module reloading.

### Build

```bash
npm run build
```

Production build output goes to `dist/`.

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── common/          # Reusable components (Sidebar, TopBar, Charts)
│   │   ├── dashboard/       # System monitoring widgets
│   │   ├── docker/          # Docker management
│   │   ├── database/        # Database UI
│   │   ├── terminal/        # Terminal interface
│   │   ├── logs/            # Logs viewer
│   │   ├── maya/            # Maya AI interface
│   │   └── settings/        # Configuration pages
│   ├── context/
│   │   ├── ThemeContext.tsx # Theme management with CSS variables
│   │   └── WebSocketContext.tsx # Real-time data streaming
│   ├── hooks/
│   │   ├── useSystemStats.ts # System stats hook
│   │   ├── useDocker.ts      # Docker operations hook
│   │   └── useMaya.ts        # Maya AI hook
│   ├── utils/
│   │   ├── api.ts           # Axios HTTP client
│   │   └── formatters.ts    # Utility functions
│   ├── App.tsx              # Main app component
│   ├── main.tsx             # React entry point
│   └── index.css            # Global styles
├── index.html               # HTML entry point
├── vite.config.ts           # Vite configuration
├── tailwind.config.js       # TailwindCSS configuration
├── tsconfig.json            # TypeScript configuration
└── package.json             # Dependencies and scripts
```

## Key Components

### Dashboard
- System overview cards (hostname, OS, uptime, containers)
- CPU monitoring with per-core usage visualization
- Memory management with module information
- Storage drives with health indicators
- GPU monitoring with VRAM usage
- Network interfaces with traffic charts

### Docker
- Container grid with status indicators
- Real-time resource usage (CPU, memory)
- Quick actions menu (start, stop, restart, logs, shell, remove)
- Container filtering and sorting

### Terminal
- Multiple tab support
- xterm.js with full color and cursor support
- Responsive layout
- Customized Trakend OS theme

### Logs
- Real-time log streaming via WebSocket
- Filtering by severity, source, and search text
- Statistics panel with log counts
- Export functionality

### Maya AI
- Status dashboard with health score gauge
- One-click actions (Investigate, Deep Scan, Optimize, Find Duplicates)
- Chat interface for natural language queries
- Notification feed with timestamps
- Real-time task progress tracking

### Settings
- General: Hostname, timezone, language
- SSH: Port, authentication methods, authorized keys
- Docker: Daemon socket, network driver, storage driver
- Theme: Dark/light mode, color presets, custom colors
- Maya AI: Enable/disable, scan frequency, auto-repair, notifications
- Updates: Version info, check frequency, auto-update, update history

## Theme System

The theme system supports:
- **CSS Variables**: All colors injected as CSS variables for runtime theming
- **Dark/Light Modes**: Toggle between interfaces with persistent storage
- **Color Presets**: Quick apply predefined color schemes
- **Custom Colors**: Fine-grained control over all UI colors
- **localStorage**: Theme preferences saved and restored on reload

## WebSocket Integration

The frontend expects a WebSocket connection that provides:
- `system-stats`: Real-time CPU, memory, storage, GPU, network data
- `docker-event`: Container lifecycle events
- `log`: Application logs
- `maya-notification`: AI assistant notifications

## API Integration

The frontend integrates with a REST API at `http://localhost:3001/api`:
- `GET /docker/containers` - List containers
- `POST /docker/containers/{id}/start` - Start container
- `POST /docker/containers/{id}/stop` - Stop container
- `GET /maya/status` - Get Maya AI status
- `POST /maya/chat` - Send message to Maya
- And more...

## Customization

### Colors

Edit `src/context/ThemeContext.tsx` to change default colors:
```typescript
const defaultDarkTheme: ThemeColors = {
  primary: '#1a1a1a',
  secondary: '#2a2a2a',
  accent: '#ff6b35',
  // ...
}
```

### Sidebar Navigation

Edit `src/components/common/Sidebar.tsx` to add/remove navigation items:
```typescript
const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
  // ...
]
```

### Dashboard Widgets

Create new widgets in `src/components/dashboard/` and add them to `Dashboard.tsx`.

## Performance

- Uses React.memo and useCallback for optimization
- Lazy loads pages with React Router
- Efficient WebSocket message handling
- TailwindCSS for minimal CSS bundle

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## License

MIT License - See LICENSE file for details

## Contributing

Pull requests welcome! Please follow the existing code style and add tests for new features.

## Support

For issues and feature requests, please open a GitHub issue.
