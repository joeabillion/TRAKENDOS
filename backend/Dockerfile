FROM node:20-slim

WORKDIR /app

# Install build dependencies for native modules (node-pty, better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Create data directory
RUN mkdir -p /app/data/db /app/data/logs

EXPOSE 3001

CMD ["node", "dist/index.js"]
