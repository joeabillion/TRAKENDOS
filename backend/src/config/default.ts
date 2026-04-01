export const DEFAULT_CONFIG = {
  SERVER: {
    PORT: parseInt(process.env.PORT || '3001', 10),
    HOST: process.env.HOST || '0.0.0.0',
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
  DATABASE: {
    PATH: process.env.DB_PATH || '/var/lib/trakend-os/trakend.db',
  },
  JWT: {
    SECRET: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    EXPIRY: '24h',
  },
  DOCKER: {
    SOCKET: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
  },
  MONITORING: {
    STATS_INTERVAL_MS: 2000,
    HISTORY_DURATION_MS: 5 * 60 * 1000,
  },
  LOGGING: {
    LEVEL: process.env.LOG_LEVEL || 'info',
    FILE_PATH: process.env.LOG_FILE || '/var/log/trakend-os/app.log',
  },
  MAYA: {
    ENABLED: process.env.MAYA_ENABLED !== 'false',
    OLLAMA_URL: process.env.OLLAMA_URL || 'http://localhost:11434',
    MODEL: process.env.MAYA_MODEL || 'neural-chat',
  },
  GIT: {
    REPO_URL: process.env.GIT_REPO_URL || 'https://github.com/joeabillion/TRAKENDOS.git',
    BRANCH: process.env.GIT_BRANCH || 'main',
    CHECK_INTERVAL_HOURS: parseInt(process.env.UPDATE_CHECK_HOURS || '24', 10),
  },
};

export const SEVERITY_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
} as const;

export const LOG_SOURCES = {
  SYSTEM: 'SYSTEM',
  DOCKER: 'DOCKER',
  MAYA: 'MAYA',
  USER: 'USER',
  NETWORK: 'NETWORK',
  DISK: 'DISK',
  SECURITY: 'SECURITY',
} as const;

export type SeverityLevel = keyof typeof SEVERITY_LEVELS;
export type LogSource = keyof typeof LOG_SOURCES;
