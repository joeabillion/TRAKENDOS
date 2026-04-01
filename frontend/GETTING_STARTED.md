# Getting Started with Trakend OS Frontend

## Prerequisites

Ensure you have the following installed:
- **Node.js**: 16+ (check with `node --version`)
- **npm**: 7+ (check with `npm --version`)
- **Backend**: Running on `http://localhost:3001`

## Installation

### 1. Install Dependencies
```bash
npm install
```

This will install all required packages:
- React 18
- TypeScript
- Vite
- TailwindCSS
- xterm.js
- Recharts
- And other utilities

### 2. Configure Backend Connection
Create `.env.local` in the frontend directory:
```bash
cp .env.example .env.local
```

Edit `.env.local` to match your backend URL:
```
VITE_API_URL=http://localhost:3001/api
VITE_WS_URL=ws://localhost:3001/ws
```

## Development

### Start Development Server
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

Features:
- Hot Module Replacement (HMR) - Changes reflect instantly
- TypeScript type checking
- Tailwind CSS compilation
- Vite's lightning-fast refresh

### Development Tools
- Open DevTools: `F12` or `Ctrl+Shift+I`
- Console shows any React warnings or errors
- Network tab shows API calls and WebSocket connections

## Building for Production

### Build Optimization
```bash
npm run build
```

This will:
- Compile TypeScript to JavaScript
- Bundle all modules with Vite
- Optimize and minify CSS and JavaScript
- Generate source maps for debugging
- Output to `dist/` directory

### Preview Production Build
```bash
npm run preview
```

This starts a local server to test the production build before deployment.

## Project Structure Quick Reference

```
frontend/
├── src/
│   ├── components/          # UI components
│   │   ├── common/          # Reusable: Sidebar, TopBar, Charts
│   │   ├── dashboard/       # 6 widgets for system monitoring
│   │   ├── docker/          # Container management
│   │   ├── database/        # SQL editor
│   │   ├── terminal/        # xterm.js terminal
│   │   ├── logs/            # Log viewer
│   │   ├── maya/            # AI assistant
│   │   └── settings/        # Configuration pages
│   ├── context/             # Global state (Theme, WebSocket)
│   ├── hooks/               # Custom hooks (Docker, Maya, Stats)
│   ├── utils/               # Helpers (API, formatters)
│   ├── App.tsx              # Main app component
│   ├── main.tsx             # Entry point
│   └── index.css            # Global styles
├── index.html               # HTML template
├── package.json             # Dependencies
└── vite.config.ts           # Build configuration
```

## Main Pages

Navigate using the sidebar:

### Dashboard (/)
- System overview cards
- CPU monitoring with per-core charts
- Memory usage gauge
- Storage drive cards
- GPU monitoring
- Network traffic visualization

### Docker (/docker)
- Container grid view
- Status badges and resource usage
- Right-click context menu
- Container management actions

### Database (/database)
- SQL query editor
- Table browser
- Results viewer
- Export/Import functionality

### Terminal (/terminal)
- Multi-tab terminal
- Full xterm.js support
- Color and cursor support
- Responsive layout

### Logs (/logs)
- Real-time log streaming
- Filter by severity, source, text
- Statistics panel
- Export logs

### Maya AI (/maya)
- Status dashboard
- Health score gauge
- One-click actions
- Chat interface
- Notification feed

### Settings (/settings)
- General configuration
- SSH settings
- Docker daemon settings
- Theme customization with color pickers
- Maya AI configuration
- System updates

## Theme Customization

### Quick Access
Settings > Theme tab

### Features
- Toggle between Dark/Light modes
- 3 preset themes (Dark, Ocean, Forest)
- Custom color picker for 8+ UI elements
- Live preview of changes
- Auto-save to localStorage

### Color Elements
- Primary Background
- Secondary Background
- Accent Color (main theme)
- Surface Color
- Success, Warning, Error, Info colors

## Common Tasks

### Start Fresh
```bash
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### Type Check
```bash
npx tsc --noEmit
```

### Debug WebSocket
Open browser console and look for:
- `WebSocket connected` - Connection established
- `Message received` - Data updates
- Check Network tab > WS for WebSocket activity

### Debug API Calls
Network tab > Fetch/XHR shows all API requests

### Clear Application Cache
```bash
# Clear browser cache/storage
# In DevTools: Application > Clear storage

# Or in code:
localStorage.clear()
sessionStorage.clear()
```

## Performance Tips

1. **Monitor Bundle Size**
   ```bash
   npm run build
   # Check dist/ folder size
   ```

2. **Use React DevTools Extension**
   - Install Chrome/Firefox extension
   - Profile components
   - Check render counts

3. **Check Network Activity**
   - DevTools > Network tab
   - Monitor WebSocket connections
   - Check API response times

## Troubleshooting

### Port 5173 Already in Use
```bash
# Use different port
npm run dev -- --port 3000
```

### Backend Connection Failed
- Verify backend is running on `http://localhost:3001`
- Check `.env.local` configuration
- Look for CORS errors in console
- Verify proxy settings in `vite.config.ts`

### TypeScript Errors
```bash
# Rebuild TypeScript
npx tsc --noEmit
```

### Styling Issues
```bash
# Rebuild TailwindCSS
npm run dev
# Usually rebuilds automatically on save
```

### WebSocket Not Connecting
1. Check backend WebSocket endpoint
2. Verify firewall/proxy settings
3. Check browser console for connection errors
4. Look for message: "WebSocket connected"

## Browser DevTools

### React DevTools
- Inspect component hierarchy
- Check props and state
- Profile performance

### Network Tab
- Monitor API calls
- Check WebSocket messages
- See response sizes and times

### Console
- View logs and warnings
- Run JavaScript snippets
- Check for errors

## Deployment

### Local Deployment
```bash
npm run build
# Deploy dist/ folder to web server
```

### Environment Variables
Create production `.env` file with:
```
VITE_API_URL=https://api.production.com/api
VITE_WS_URL=wss://api.production.com/ws
VITE_DEBUG=false
```

### Docker Deployment (Example)
```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
RUN npm install -g serve
CMD ["serve", "-s", "dist", "-l", "3000"]
```

## Learning Resources

### React 18
- [React Docs](https://react.dev)
- [React Router](https://reactrouter.com)

### TypeScript
- [TypeScript Handbook](https://www.typescriptlang.org/docs)

### TailwindCSS
- [TailwindCSS Docs](https://tailwindcss.com/docs)

### Vite
- [Vite Guide](https://vitejs.dev/guide)

## Getting Help

1. **Check Documentation**
   - README.md - Full feature overview
   - IMPLEMENTATION_SUMMARY.md - Architecture details
   - Component files - Inline comments

2. **Debug Output**
   - Browser console (F12)
   - Network tab for API/WebSocket
   - Terminal for build errors

3. **Common Issues**
   - Check .env configuration
   - Verify backend is running
   - Clear node_modules and reinstall

## Next Steps

1. Customize theme colors in Settings
2. Connect to your backend API
3. Test WebSocket connection
4. Deploy to production
5. Add authentication (if needed)
6. Configure HTTPS for production
7. Set up monitoring and logging

Happy coding!
