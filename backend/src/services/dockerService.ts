import Docker from 'dockerode';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EventLogger } from './eventLogger';

/** Error carrying an HTTP status code so routes can return 400 for bad input. */
export class DockerServiceError extends Error {
  status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.name = 'DockerServiceError';
    this.status = status;
  }
}

const ALLOWED_PATH_PREFIXES = ['/data/', '/mnt/disks/'];

/**
 * Resolve a user-supplied path and require it to live under one of the allowed roots.
 * Throws a 400-style DockerServiceError otherwise.
 */
export function assertAllowedPath(input: unknown, label: string = 'path'): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new DockerServiceError(`${label} is required`, 400);
  }
  if (/[\0\r\n]/.test(input)) {
    throw new DockerServiceError(`${label} contains invalid characters`, 400);
  }
  const resolved = path.resolve(input);
  const ok = ALLOWED_PATH_PREFIXES.some((prefix) => resolved === prefix.slice(0, -1) || resolved.startsWith(prefix));
  if (!ok) {
    throw new DockerServiceError(
      `${label} must be under ${ALLOWED_PATH_PREFIXES.join(' or ')} (got ${resolved})`,
      400
    );
  }
  return resolved;
}

/** Run a command without a shell; returns stdout as a string. */
function run(cmd: string, args: string[], opts: { allowFail?: boolean; timeoutMs?: number } = {}): string {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (opts.allowFail) return '';
    throw err;
  }
}

/** Keys that may be written into /etc/docker/daemon.json via the settings API. */
const DAEMON_JSON_ALLOWED_KEYS = new Set([
  'log-driver',
  'log-opts',
  'storage-driver',
  'default-address-pools',
  'dns',
  'registry-mirrors',
  'live-restore',
  'max-concurrent-downloads',
  'runtimes',
  'default-runtime',
]);
const DAEMON_JSON_REJECTED_KEYS = ['hosts', 'insecure-registries'];

const DAEMON_JSON_PATH = '/etc/docker/daemon.json';
const DEFAULT_DATA_ROOT = '/data/docker';

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: Array<{ privatePort: number; publicPort?: number; type: string }>;
  created: number;
  startedAt?: number;
  restartPolicy?: {
    name: string;
    maxRetryCount?: number;
  };
  memory?: number;
  memoryUsage?: number;
  cpuUsage?: number;
  networkMode?: string;
  volumes?: Record<string, string>;
}

export interface ImageInfo {
  id: string;
  repoTags: string[];
  size: number;
  created: number;
  virtualSize?: number;
  dangling?: boolean;
}

export interface NetworkInfo {
  name: string;
  id: string;
  driver: string;
  scope: string;
  containers: Record<string, any>;
  options: Record<string, string>;
}

export interface VolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
  labels: Record<string, string>;
  options: Record<string, string>;
}

export interface DockerSettings {
  dataRoot?: string;
  logDriver?: string;
  storageDriver?: string;
  otherSettings?: Record<string, any>;
}

export interface StorageUsage {
  imagesSize: number;
  containersSize: number;
  volumesSize: number;
  buildCacheSize: number;
}

export class DockerService {
  private docker: Docker;
  private logger: EventLogger;
  private statsCache: Map<string, any> = new Map();
  private execSessions: Map<string, { containerId: string; exec: any; shell?: string }> = new Map();

  constructor(socketPath: string, logger: EventLogger) {
    this.docker = new Docker({
      socketPath,
    });
    this.logger = logger;
  }

  async listContainers(all: boolean = false): Promise<ContainerInfo[]> {
    try {
      const containers = await this.docker.listContainers({ all });

      return containers.map((container) => ({
        id: container.Id.substring(0, 12),
        name: container.Names[0]?.replace(/^\//, '') || 'unknown',
        image: container.Image,
        state: container.State,
        status: container.Status,
        ports: (container.Ports || []).map((p: any) => ({
          privatePort: p.PrivatePort || p.privatePort || 0,
          publicPort: p.PublicPort || p.publicPort,
          type: p.Type || p.type || 'tcp',
        })),
        created: container.Created * 1000,
        restartPolicy: (container.HostConfig as any)?.RestartPolicy,
        memory: (container.HostConfig as any)?.Memory,
        networkMode: container.HostConfig?.NetworkMode,
      }));
    } catch (error) {
      this.logger.error('DOCKER', `Failed to list containers: ${error}`);
      throw error;
    }
  }

  async getContainerStats(containerId: string): Promise<any> {
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });

      const cpuStats = stats.cpu_stats;
      const memStats = stats.memory_stats;

      let cpuUsage = 0;
      let memUsage = 0;

      if (cpuStats && cpuStats.cpu_usage && cpuStats.system_cpu_usage) {
        const cpuDelta = cpuStats.cpu_usage.total_usage - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
        const systemDelta = cpuStats.system_cpu_usage - (stats.precpu_stats?.system_cpu_usage || 0);
        const numCpus = cpuStats.online_cpus || 1;

        if (systemDelta > 0) {
          cpuUsage = (cpuDelta / systemDelta) * numCpus * 100;
        }
      }

      if (memStats) {
        memUsage = memStats.usage;
      }

      const result = {
        containerId,
        timestamp: Date.now(),
        cpuUsage: Math.min(100, Math.max(0, cpuUsage)),
        memoryUsage: memUsage,
        memoryLimit: stats.memory_stats?.limit || 0,
        networkRx: stats.networks?.eth0?.rx_bytes || 0,
        networkTx: stats.networks?.eth0?.tx_bytes || 0,
        blockRead: stats.blkio_stats?.io_service_bytes_recursive?.[0]?.value || 0,
        blockWrite: stats.blkio_stats?.io_service_bytes_recursive?.[1]?.value || 0,
      };

      this.statsCache.set(containerId, result);
      return result;
    } catch (error) {
      this.logger.error('DOCKER', `Failed to get container stats: ${error}`);
      throw error;
    }
  }

  async getContainerLogs(containerId: string, lines: number = 100, timestamps: boolean = true): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);
      const inspect = await container.inspect();
      const isTty = Boolean(inspect?.Config?.Tty);

      const stream = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
        tail: lines,
        timestamps,
      });

      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        const readable = stream as unknown as NodeJS.ReadableStream;
        readable.on('data', (chunk: any) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        readable.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve(isTty ? buf.toString('utf-8') : DockerService.demuxLogBuffer(buf));
        });
        readable.on('error', reject);
      });
    } catch (error) {
      this.logger.error('DOCKER', `Failed to get container logs: ${error}`);
      throw error;
    }
  }

  /**
   * Strip the 8-byte multiplexing frame headers Docker adds to log/attach streams
   * for non-TTY containers: [stream type (1), 0,0,0, size (4, big endian)] + payload.
   */
  static demuxLogBuffer(buf: Buffer): string {
    let out = '';
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const streamType = buf[offset];
      // Validate header shape; if it doesn't look like a frame, dump the rest raw.
      if ((streamType !== 0 && streamType !== 1 && streamType !== 2) || buf[offset + 1] !== 0 || buf[offset + 2] !== 0 || buf[offset + 3] !== 0) {
        out += buf.subarray(offset).toString('utf-8');
        return out;
      }
      const size = buf.readUInt32BE(offset + 4);
      const start = offset + 8;
      const end = Math.min(start + size, buf.length);
      out += buf.subarray(start, end).toString('utf-8');
      offset = end;
    }
    if (offset < buf.length) {
      out += buf.subarray(offset).toString('utf-8');
    }
    return out;
  }

  async startContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.start();
      this.logger.info('DOCKER', `Container ${containerId} started`);
    } catch (error) {
      this.logger.error('DOCKER', `Failed to start container ${containerId}: ${error}`);
      throw error;
    }
  }

  async stopContainer(containerId: string, timeout: number = 10): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: timeout });
      this.logger.info('DOCKER', `Container ${containerId} stopped`);
    } catch (error) {
      this.logger.error('DOCKER', `Failed to stop container ${containerId}: ${error}`);
      throw error;
    }
  }

  async restartContainer(containerId: string, timeout: number = 10): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.restart({ t: timeout });
      this.logger.info('DOCKER', `Container ${containerId} restarted`);
    } catch (error) {
      this.logger.error('DOCKER', `Failed to restart container ${containerId}: ${error}`);
      throw error;
    }
  }

  async removeContainer(containerId: string, force: boolean = false): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force });
      this.logger.info('DOCKER', `Container ${containerId} removed`);
    } catch (error) {
      this.logger.error('DOCKER', `Failed to remove container ${containerId}: ${error}`);
      throw error;
    }
  }

  async updateContainerSettings(containerId: string, settings: any): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);

      const updateConfig = {
        MemorySwap: settings.memorySwap,
        MemoryReservation: settings.memoryReservation,
        CpuShares: settings.cpuShares,
        CpuPeriod: settings.cpuPeriod,
        CpuQuota: settings.cpuQuota,
        RestartPolicy: settings.restartPolicy,
      };

      // Filter out undefined values
      Object.keys(updateConfig).forEach((key) => {
        if (updateConfig[key as keyof typeof updateConfig] === undefined) {
          delete updateConfig[key as keyof typeof updateConfig];
        }
      });

      await container.update(updateConfig);
      this.logger.info('DOCKER', `Container ${containerId} settings updated`);
    } catch (error) {
      this.logger.error('DOCKER', `Failed to update container settings: ${error}`);
      throw error;
    }
  }

  async listImages(): Promise<ImageInfo[]> {
    try {
      const images = await this.docker.listImages();
      const containers = await this.docker.listContainers({ all: true });

      return images.map((image) => {
        // Count containers using this image
        const containersUsing = containers.filter((c) => c.Image === image.Id || image.RepoTags?.some((tag) => c.Image === tag)).length;

        return {
          id: image.Id.substring(7, 19), // Remove sha256: prefix
          repoTags: image.RepoTags || [],
          size: image.Size,
          created: image.Created * 1000,
          virtualSize: image.VirtualSize,
          dangling: !image.RepoTags || image.RepoTags.length === 0,
        };
      });
    } catch (error) {
      this.logger.error('DOCKER', `Failed to list images: ${error}`);
      throw error;
    }
  }

  async pullImage(imageRef: string, onProgress?: (progress: any) => void): Promise<void> {
    try {
      const stream = await this.docker.pull(imageRef);

      return new Promise((resolve, reject) => {
        this.docker.modem.followProgress(
          stream,
          (err, res) => {
            if (err) {
              this.logger.error('DOCKER', `Failed to pull image ${imageRef}: ${err}`);
              reject(err);
            } else {
              this.logger.info('DOCKER', `Image ${imageRef} pulled successfully`);
              resolve();
            }
          },
          onProgress
        );
      });
    } catch (error) {
      this.logger.error('DOCKER', `Failed to pull image ${imageRef}: ${error}`);
      throw error;
    }
  }

  async removeImage(imageId: string, force: boolean = false): Promise<void> {
    try {
      const image = this.docker.getImage(imageId);
      await image.remove({ force });
      this.logger.info('DOCKER', `Image ${imageId} removed`);
    } catch (error) {
      this.logger.error('DOCKER', `Failed to remove image ${imageId}: ${error}`);
      throw error;
    }
  }

  async listNetworks(): Promise<NetworkInfo[]> {
    try {
      const networks = await this.docker.listNetworks();

      return networks.map((network) => ({
        name: network.Name,
        id: network.Id.substring(0, 12),
        driver: network.Driver,
        scope: network.Scope,
        containers: network.Containers || {},
        options: network.Options || {},
      }));
    } catch (error) {
      this.logger.error('DOCKER', `Failed to list networks: ${error}`);
      throw error;
    }
  }

  async listVolumes(): Promise<VolumeInfo[]> {
    try {
      const result = await this.docker.listVolumes();
      const containers = await this.docker.listContainers({ all: true });

      return (result.Volumes || []).map((volume) => {
        // Count containers using this volume
        let containersUsing = 0;
        for (const container of containers) {
          const inspectData = JSON.stringify(container);
          if (inspectData.includes(volume.Name)) {
            containersUsing++;
          }
        }

        return {
          name: volume.Name,
          driver: volume.Driver,
          mountpoint: volume.Mountpoint,
          labels: volume.Labels || {},
          options: volume.Options || {},
        };
      });
    } catch (error) {
      this.logger.error('DOCKER', `Failed to list volumes: ${error}`);
      throw error;
    }
  }

  async inspectContainer(containerId: string): Promise<any> {
    try {
      const container = this.docker.getContainer(containerId);
      return await container.inspect();
    } catch (error) {
      this.logger.error('DOCKER', `Failed to inspect container ${containerId}: ${error}`);
      throw error;
    }
  }

  streamContainerStats(containerId: string, onData: (stats: any) => void): Promise<NodeJS.ReadableStream> {
    return new Promise((resolve, reject) => {
      const container = this.docker.getContainer(containerId);

      container.stats({ stream: true }, (err: any, stream: any) => {
        if (err) {
          reject(err);
          return;
        }

        if (!stream) {
          reject(new Error('No stream returned'));
          return;
        }

        let buffer = '';

        stream.on('data', (chunk: any) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');

          for (let i = 0; i < lines.length - 1; i++) {
            try {
              const stats = JSON.parse(lines[i]);
              onData(stats);
            } catch {
              // Invalid JSON, skip
            }
          }

          buffer = lines[lines.length - 1];
        });

        stream.on('error', reject);
        stream.on('end', () => {
          if (buffer) {
            try {
              const stats = JSON.parse(buffer);
              onData(stats);
            } catch {
              // Invalid JSON, skip
            }
          }
        });

        resolve(stream);
      });
    });
  }

  async getSettings(): Promise<any> {
    try {
      const daemonConfigPath = '/etc/docker/daemon.json';
      let daemonConfig: any = {};

      if (fs.existsSync(daemonConfigPath)) {
        try {
          const content = fs.readFileSync(daemonConfigPath, 'utf-8');
          daemonConfig = JSON.parse(content);
        } catch (parseError) {
          this.logger.warn('DOCKER', `Failed to parse daemon.json: ${parseError}`);
        }
      }

      // Get disk usage
      let storageUsage: StorageUsage = {
        imagesSize: 0,
        containersSize: 0,
        volumesSize: 0,
        buildCacheSize: 0,
      };

      try {
        const dfOutput = run('docker', ['system', 'df', '--format', '{{json .}}']);
        const lines = dfOutput.trim().split('\n');
        if (lines.length > 0) {
          const parsed = JSON.parse(lines[0]);
          storageUsage = {
            imagesSize: parsed.Images || 0,
            containersSize: parsed.Containers || 0,
            volumesSize: parsed.Volumes || 0,
            buildCacheSize: parsed.BuildCache || 0,
          };
        }
      } catch (error) {
        this.logger.warn('DOCKER', `Failed to get storage usage: ${error}`);
      }

      return {
        daemonConfig,
        storageUsage,
        dataRoot: daemonConfig['data-root'] || DEFAULT_DATA_ROOT,
      };
    } catch (error) {
      this.logger.error('DOCKER', `Failed to get Docker settings: ${error}`);
      throw error;
    }
  }

  async updateSettings(settings: DockerSettings): Promise<void> {
    try {
      const daemonConfigPath = '/etc/docker/daemon.json';

      let daemonConfig: any = {};
      if (fs.existsSync(daemonConfigPath)) {
        try {
          const content = fs.readFileSync(daemonConfigPath, 'utf-8');
          daemonConfig = JSON.parse(content);
        } catch {
          // Start with empty config
        }
      }

      // Update settings
      if (settings.dataRoot) {
        daemonConfig['data-root'] = assertAllowedPath(settings.dataRoot, 'dataRoot');
      }
      if (settings.logDriver) {
        if (typeof settings.logDriver !== 'string' || !/^[a-z0-9_-]+$/i.test(settings.logDriver)) {
          throw new DockerServiceError('Invalid logDriver', 400);
        }
        daemonConfig['log-driver'] = settings.logDriver;
      }
      if (settings.storageDriver) {
        if (typeof settings.storageDriver !== 'string' || !/^[a-z0-9_-]+$/i.test(settings.storageDriver)) {
          throw new DockerServiceError('Invalid storageDriver', 400);
        }
        daemonConfig['storage-driver'] = settings.storageDriver;
      }
      if (settings.otherSettings && typeof settings.otherSettings === 'object') {
        for (const [key, value] of Object.entries(settings.otherSettings)) {
          if (DAEMON_JSON_REJECTED_KEYS.includes(key) || key.startsWith('tls')) {
            throw new DockerServiceError(`daemon.json key "${key}" cannot be set through the API`, 400);
          }
          if (!DAEMON_JSON_ALLOWED_KEYS.has(key)) {
            throw new DockerServiceError(`daemon.json key "${key}" is not allowed`, 400);
          }
          if (value === null || value === undefined) {
            delete daemonConfig[key];
          } else {
            daemonConfig[key] = value;
          }
        }
      }

      // Write back
      fs.writeFileSync(daemonConfigPath, JSON.stringify(daemonConfig, null, 2));

      // Restart Docker
      try {
        run('systemctl', ['restart', 'docker']);
        this.logger.info('DOCKER', 'Docker daemon restarted after settings update');
      } catch (restartError) {
        this.logger.warn('DOCKER', `Failed to restart docker: ${restartError}`);
      }
    } catch (error) {
      this.logger.error('DOCKER', `Failed to update Docker settings: ${error}`);
      throw error;
    }
  }

  private readDaemonConfig(): any {
    if (fs.existsSync(DAEMON_JSON_PATH)) {
      try {
        return JSON.parse(fs.readFileSync(DAEMON_JSON_PATH, 'utf-8'));
      } catch {
        return {};
      }
    }
    return {};
  }

  getDataRoot(): string {
    const cfg = this.readDaemonConfig();
    return typeof cfg['data-root'] === 'string' && cfg['data-root'] ? cfg['data-root'] : DEFAULT_DATA_ROOT;
  }

  async migrateStorage(newPathInput: string, onProgress?: (message: string) => void): Promise<void> {
    try {
      const progressLog = (msg: string) => {
        this.logger.info('DOCKER', msg);
        if (onProgress) {
          onProgress(msg);
        }
      };

      const newPath = assertAllowedPath(newPathInput, 'newPath');
      const daemonConfig = this.readDaemonConfig();
      const oldPath = path.resolve(daemonConfig['data-root'] || DEFAULT_DATA_ROOT);

      if (oldPath === newPath) {
        throw new DockerServiceError('New path is the same as the current data-root', 400);
      }
      if (newPath.startsWith(oldPath + '/')) {
        throw new DockerServiceError('New path cannot be inside the current data-root', 400);
      }

      progressLog(`Starting Docker storage migration from ${oldPath} to ${newPath}`);

      // Stop all containers
      progressLog('Stopping all containers...');
      const ids = run('docker', ['ps', '-aq'], { allowFail: true }).split('\n').map((l) => l.trim()).filter(Boolean);
      if (ids.length > 0) {
        run('docker', ['stop', ...ids], { allowFail: true });
      }

      // Stop Docker daemon
      progressLog('Stopping Docker daemon...');
      run('systemctl', ['stop', 'docker', 'docker.socket']);

      try {
        // Create target directory if needed
        progressLog(`Creating target directory: ${newPath}`);
        fs.mkdirSync(newPath, { recursive: true });

        // Rsync data
        if (fs.existsSync(oldPath)) {
          progressLog(`Syncing data from ${oldPath} to ${newPath}...`);
          run('rsync', ['-aHAX', `${oldPath}/`, `${newPath}/`]);
        } else {
          progressLog(`Old data-root ${oldPath} does not exist; starting fresh at ${newPath}`);
        }

        // Update daemon.json
        progressLog('Updating daemon.json...');
        daemonConfig['data-root'] = newPath;
        fs.mkdirSync(path.dirname(DAEMON_JSON_PATH), { recursive: true });
        fs.writeFileSync(DAEMON_JSON_PATH, JSON.stringify(daemonConfig, null, 2));
      } finally {
        // Always bring Docker back
        progressLog('Starting Docker daemon...');
        run('systemctl', ['start', 'docker.socket', 'docker'], { allowFail: true });
      }

      // Verify
      progressLog('Verifying containers...');
      run('docker', ['ps', '-a']);
      progressLog('Docker storage migration completed successfully');
    } catch (error) {
      this.logger.error('DOCKER', `Failed to migrate storage: ${error}`);
      throw error;
    }
  }

  async fullBackup(destPathInput: string, onProgress?: (message: string) => void): Promise<string> {
    try {
      const progressLog = (msg: string) => {
        this.logger.info('DOCKER', msg);
        if (onProgress) {
          onProgress(msg);
        }
      };

      const destPath = assertAllowedPath(destPathInput, 'destPath');

      // Ensure destination directory exists
      fs.mkdirSync(destPath, { recursive: true });

      const backupName = `docker-backup-${Date.now()}`;
      const backupDir = path.join(destPath, backupName);
      const backupPath = `${backupDir}.tar.gz`;

      fs.mkdirSync(backupDir, { recursive: true });

      const manifest: any = {
        timestamp: new Date().toISOString(),
        images: [],
        containers: [],
        volumes: [],
      };

      // Backup all images
      progressLog('Backing up Docker images...');
      const imagesOutput = run('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}']);
      const images = imagesOutput
        .trim()
        .split('\n')
        .filter((img: string) => img && img !== '<none>:<none>' && !img.includes('<none>'));

      for (const image of images) {
        try {
          progressLog(`Saving image: ${image}`);
          const imageSafeName = image.replace(/[^A-Za-z0-9._-]/g, '_');
          const imageFile = path.join(backupDir, `image_${imageSafeName}.tar`);
          run('docker', ['save', image, '-o', imageFile]);
          manifest.images.push({ name: image, file: `image_${imageSafeName}.tar` });
        } catch (imageError) {
          this.logger.warn('DOCKER', `Failed to save image ${image}: ${imageError}`);
        }
      }

      // Backup all containers
      progressLog('Backing up container configurations...');
      const containersOutput = run('docker', ['ps', '-a', '--format', '{{.ID}}']);
      const containers = containersOutput.trim().split('\n').filter((id: string) => /^[0-9a-f]+$/i.test(id));

      for (const containerId of containers) {
        try {
          progressLog(`Backing up container: ${containerId}`);
          const inspectOutput = run('docker', ['inspect', containerId]);
          const containerConfig = JSON.parse(inspectOutput)[0];
          const containerName = String(containerConfig.Name || containerId)
            .replace(/^\//, '')
            .replace(/[^A-Za-z0-9._-]/g, '_');
          const configFile = path.join(backupDir, `container_${containerName}_config.json`);
          fs.writeFileSync(configFile, JSON.stringify(containerConfig, null, 2));
          manifest.containers.push({
            id: containerId,
            name: containerName,
            configFile: `container_${containerName}_config.json`,
          });
        } catch (containerError) {
          this.logger.warn('DOCKER', `Failed to backup container ${containerId}: ${containerError}`);
        }
      }

      // Backup volumes
      progressLog('Backing up volumes...');
      const volumesOutput = run('docker', ['volume', 'ls', '--format', '{{.Name}}']);
      const volumes = volumesOutput.trim().split('\n').filter((vol: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(vol));

      const volumesDir = path.join(backupDir, 'volumes');
      fs.mkdirSync(volumesDir, { recursive: true });

      for (const volumeName of volumes) {
        try {
          progressLog(`Backing up volume: ${volumeName}`);
          const volumeMount = run('docker', ['volume', 'inspect', volumeName, '--format', '{{.Mountpoint}}']).trim();
          if (volumeMount && fs.existsSync(volumeMount)) {
            const target = path.join(volumesDir, volumeName);
            fs.mkdirSync(target, { recursive: true });
            run('rsync', ['-aHAX', `${volumeMount}/`, `${target}/`]);
            manifest.volumes.push(volumeName);
          }
        } catch (volError) {
          this.logger.warn('DOCKER', `Failed to backup volume ${volumeName}: ${volError}`);
        }
      }

      // Write manifest
      progressLog('Writing manifest...');
      fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

      // Create tar.gz
      progressLog('Compressing backup...');
      run('tar', ['-czf', backupPath, '-C', path.dirname(backupDir), backupName]);

      // Cleanup temporary directory
      fs.rmSync(backupDir, { recursive: true, force: true });

      progressLog(`Backup completed: ${backupPath}`);
      return backupPath;
    } catch (error) {
      this.logger.error('DOCKER', `Failed to create full backup: ${error}`);
      throw error;
    }
  }

  async fullRestore(backupPathInput: string, onProgress?: (message: string) => void): Promise<void> {
    let tempDir: string | null = null;
    try {
      const progressLog = (msg: string) => {
        this.logger.info('DOCKER', msg);
        if (onProgress) {
          onProgress(msg);
        }
      };

      const backupPath = assertAllowedPath(backupPathInput, 'backupPath');
      if (!backupPath.endsWith('.tar.gz')) {
        throw new DockerServiceError('backupPath must point to a .tar.gz file', 400);
      }
      if (!fs.existsSync(backupPath) || !fs.statSync(backupPath).isFile()) {
        throw new DockerServiceError(`Backup file not found: ${backupPath}`, 400);
      }

      progressLog('Extracting backup...');
      tempDir = fs.mkdtempSync(path.join('/tmp', 'docker-restore-'));

      run('tar', ['-xzf', backupPath, '-C', tempDir]);

      // Find the extracted backup directory
      const files = fs.readdirSync(tempDir).filter((f) => fs.statSync(path.join(tempDir as string, f)).isDirectory());
      if (files.length === 0) {
        throw new DockerServiceError('Backup archive does not contain a backup directory', 400);
      }
      const backupDir = path.join(tempDir, files[0]);

      // Read manifest
      progressLog('Reading manifest...');
      const manifestPath = path.join(backupDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new DockerServiceError('Manifest not found in backup', 400);
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      // Only allow files that stay inside backupDir
      const safeJoin = (base: string, name: unknown): string | null => {
        if (typeof name !== 'string' || !name) return null;
        const joined = path.resolve(base, name);
        return joined.startsWith(base + path.sep) ? joined : null;
      };

      // Restore images
      progressLog('Restoring Docker images...');
      for (const image of manifest.images || []) {
        try {
          const imageFile = safeJoin(backupDir, image.file);
          if (imageFile && fs.existsSync(imageFile)) {
            progressLog(`Loading image: ${image.name}`);
            run('docker', ['load', '-i', imageFile]);
          }
        } catch (imageError) {
          this.logger.warn('DOCKER', `Failed to restore image ${image.name}: ${imageError}`);
        }
      }

      // Restore volumes
      progressLog('Restoring volumes...');
      const volumesDir = path.join(backupDir, 'volumes');
      if (fs.existsSync(volumesDir)) {
        for (const volumeName of manifest.volumes || []) {
          try {
            if (typeof volumeName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(volumeName)) {
              this.logger.warn('DOCKER', `Skipping volume with invalid name: ${volumeName}`);
              continue;
            }
            progressLog(`Creating volume: ${volumeName}`);
            run('docker', ['volume', 'create', volumeName]);

            const volumeMount = run('docker', ['volume', 'inspect', volumeName, '--format', '{{.Mountpoint}}']).trim();

            const sourceVolume = safeJoin(volumesDir, volumeName);
            if (sourceVolume && volumeMount && fs.existsSync(sourceVolume)) {
              progressLog(`Restoring volume data: ${volumeName}`);
              run('rsync', ['-aHAX', `${sourceVolume}/`, `${volumeMount}/`]);
            }
          } catch (volError) {
            this.logger.warn('DOCKER', `Failed to restore volume ${volumeName}: ${volError}`);
          }
        }
      }

      // Restore containers (just report their configs are available)
      progressLog('Restoring containers...');
      for (const container of manifest.containers || []) {
        try {
          const configFile = safeJoin(backupDir, container.configFile);
          if (configFile && fs.existsSync(configFile)) {
            progressLog(`Container config available: ${container.name}`);
            // Note: Full container restoration would require more complex logic
            this.logger.info('DOCKER', `Container ${container.name} config available for manual recreation`);
          }
        } catch (containerError) {
          this.logger.warn('DOCKER', `Failed to restore container ${container.name}: ${containerError}`);
        }
      }

      progressLog('Restore completed');
    } catch (error) {
      this.logger.error('DOCKER', `Failed to restore from backup: ${error}`);
      throw error;
    } finally {
      if (tempDir) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * Last-resort removal for "ghost" containers that the daemon refuses to remove
   * (e.g. after a crash leaves a stale state directory). Stops Docker, deletes the
   * container's directory under <data-root>/containers/, restarts Docker and returns
   * the names of the remaining containers.
   */
  async nukeContainer(containerId: string): Promise<{ removedId: string; containers: string[] }> {
    if (typeof containerId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(containerId)) {
      throw new DockerServiceError('Invalid container id', 400);
    }

    const dataRoot = this.getDataRoot();
    const containersDir = path.join(dataRoot, 'containers');

    let fullId: string | null = null;

    // 1. Ask the daemon (works for id prefixes and names)
    try {
      const info = await this.docker.getContainer(containerId).inspect();
      if (info?.State?.Running) {
        throw new DockerServiceError('Container is running; stop it first (or use normal remove)', 409);
      }
      fullId = info.Id;
    } catch (err) {
      if (err instanceof DockerServiceError) throw err;
      // Daemon doesn't know about it; fall through to directory scan
    }

    // 2. Fall back to matching a directory prefix under <data-root>/containers/
    if (!fullId) {
      if (!/^[0-9a-f]{4,64}$/i.test(containerId)) {
        throw new DockerServiceError(
          `Container "${containerId}" is unknown to the daemon; pass a hex id prefix to match its state directory`,
          404
        );
      }
      if (!fs.existsSync(containersDir)) {
        throw new DockerServiceError(`Containers directory not found: ${containersDir}`, 404);
      }
      const matches = fs
        .readdirSync(containersDir)
        .filter((d) => /^[0-9a-f]{64}$/.test(d) && d.startsWith(containerId.toLowerCase()));
      if (matches.length === 0) {
        throw new DockerServiceError(`No container state directory matches "${containerId}"`, 404);
      }
      if (matches.length > 1) {
        throw new DockerServiceError(`Ambiguous id prefix "${containerId}" matches ${matches.length} containers`, 400);
      }
      fullId = matches[0];
    }

    if (!/^[0-9a-f]{64}$/.test(fullId)) {
      throw new DockerServiceError(`Resolved id "${fullId}" is not a full container id`, 500);
    }

    const target = path.join(containersDir, fullId);
    const resolvedTarget = path.resolve(target);
    if (!resolvedTarget.startsWith(path.resolve(containersDir) + path.sep)) {
      throw new DockerServiceError('Refusing to remove a path outside the containers directory', 400);
    }

    if (!fs.existsSync(resolvedTarget)) {
      throw new DockerServiceError(`No on-disk state found for ${fullId} under ${containersDir} — nothing to nuke`, 404);
    }

    this.logger.warn('DOCKER', `Nuking container ${fullId}: stopping docker and removing ${resolvedTarget}`);

    run('systemctl', ['stop', 'docker', 'docker.socket']);
    try {
      fs.rmSync(resolvedTarget, { recursive: true, force: true });
    } finally {
      run('systemctl', ['start', 'docker.socket', 'docker'], { allowFail: true });
    }

    // Wait briefly for the daemon to come back and list containers
    let containers: string[] = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const list = await this.docker.listContainers({ all: true });
        containers = list.map((c) => (c.Names?.[0] || c.Id.substring(0, 12)).replace(/^\//, ''));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    this.logger.info('DOCKER', `Container ${fullId.substring(0, 12)} nuked; ${containers.length} container(s) remain`);
    return { removedId: fullId, containers };
  }

  async forceRemoveContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);

      // Try to stop it with force
      try {
        await container.kill();
      } catch {
        // Already stopped
      }

      // Remove with force and volumes
      await container.remove({ force: true, v: true });

      // Prune anything left
      try {
        await this.docker.pruneContainers();
      } catch {
        // Cleanup attempt
      }

      this.logger.info('DOCKER', `Container ${containerId} force removed`);
    } catch (error) {
      this.logger.error('DOCKER', `Failed to force remove container ${containerId}: ${error}`);
      throw error;
    }
  }

  async pruneSystem(): Promise<any> {
    try {
      const result = await this.docker.pruneContainers();
      await this.docker.pruneImages();
      await this.docker.pruneVolumes();

      this.logger.info('DOCKER', 'System prune completed');
      return result;
    } catch (error) {
      this.logger.error('DOCKER', `Failed to prune system: ${error}`);
      throw error;
    }
  }

  async removeVolume(volumeName: string): Promise<void> {
    try {
      const volume = this.docker.getVolume(volumeName);
      await volume.remove();
      this.logger.info('DOCKER', `Volume ${volumeName} removed`);
    } catch (error) {
      this.logger.error('DOCKER', `Failed to remove volume ${volumeName}: ${error}`);
      throw error;
    }
  }

  async createExecSession(containerId: string): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);

      // Check if container is running
      const containerInfo = await container.inspect();
      if (!containerInfo.State.Running) {
        throw new Error('Container is not running');
      }

      // Try bash first, fall back to /bin/sh if bash isn't present in the image.
      // Docker's exec create succeeds even for a missing binary (it only fails on start),
      // so probe for bash with a short non-interactive exec first.
      let shell = ['/bin/bash', '-l'];
      try {
        const probe = await container.exec({
          AttachStdout: true,
          AttachStderr: true,
          Cmd: ['/bin/bash', '-c', 'exit 0'],
        });
        await new Promise<void>((resolve, reject) => {
          probe.start({ hijack: false, stdin: false }, (err: any, stream: any) => {
            if (err) return reject(err);
            if (!stream) return resolve();
            stream.on('data', () => undefined);
            stream.on('end', () => resolve());
            stream.on('error', reject);
          });
        });
        const probeInfo = await probe.inspect();
        if (probeInfo.ExitCode !== 0) {
          shell = ['/bin/sh'];
        }
      } catch {
        shell = ['/bin/sh'];
      }

      const execOptions = {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: shell,
      };

      const exec = await container.exec(execOptions);

      // Generate a unique exec session ID
      const execId = exec.id;

      // Store the exec session
      this.execSessions.set(execId, { containerId, exec, shell: shell[0] });

      // Clean up session after 1 hour of inactivity
      setTimeout(() => {
        this.execSessions.delete(execId);
      }, 60 * 60 * 1000);

      this.logger.info('DOCKER', `Created exec session ${execId} for container ${containerId}`);
      return execId;
    } catch (error) {
      this.logger.error('DOCKER', `Failed to create exec session for container ${containerId}: ${error}`);
      throw error;
    }
  }

  getExecSession(execId: string): { containerId: string; exec: any; shell?: string } | undefined {
    return this.execSessions.get(execId);
  }

  closeExecSession(execId: string): void {
    this.execSessions.delete(execId);
  }

  /**
   * Recreate a container with a (partially) new configuration while preserving
   * everything else from the existing container (devices, capabilities, labels,
   * mounts, networks, entrypoint, user, ...).
   *
   * Flow: rename old -> create new (full Config + HostConfig + NetworkingConfig, with
   * supplied overrides) -> start new -> remove old. On failure the old container is
   * renamed back and restarted if it was running.
   */
  async recreateContainer(containerId: string, newConfig: any = {}): Promise<string> {
    const container = this.docker.getContainer(containerId);
    const inspect = await container.inspect();
    const oldName = inspect.Name.replace(/^\//, '');
    const wasRunning = Boolean(inspect.State?.Running);
    const tempName = `${oldName}-old-${Date.now()}`;
    const targetName = newConfig.name || oldName;

    // Deep-copy the existing configuration
    const config: any = JSON.parse(JSON.stringify(inspect.Config || {}));
    const hostConfig: any = JSON.parse(JSON.stringify(inspect.HostConfig || {}));
    const networks: Record<string, any> = JSON.parse(JSON.stringify(inspect.NetworkSettings?.Networks || {}));

    // Apply overrides (only when supplied)
    if (newConfig.image) config.Image = newConfig.image;
    if (newConfig.cmd !== undefined) config.Cmd = newConfig.cmd;
    if (newConfig.entrypoint !== undefined) config.Entrypoint = newConfig.entrypoint;
    if (newConfig.user !== undefined) config.User = newConfig.user;
    if (newConfig.workingDir !== undefined) config.WorkingDir = newConfig.workingDir;
    if (newConfig.labels && typeof newConfig.labels === 'object') {
      config.Labels = { ...(config.Labels || {}), ...newConfig.labels };
    }

    if (newConfig.env !== undefined) {
      if (Array.isArray(newConfig.env)) {
        config.Env = newConfig.env.map((e: any) =>
          typeof e === 'string' ? e : `${e.name ?? e.key}=${e.value ?? ''}`
        );
      } else if (typeof newConfig.env === 'object') {
        config.Env = Object.entries(newConfig.env).map(([k, v]) => `${k}=${v}`);
      }
    }

    if (newConfig.portBindings !== undefined) hostConfig.PortBindings = newConfig.portBindings;
    if (newConfig.binds !== undefined) hostConfig.Binds = newConfig.binds;
    if (newConfig.restartPolicy !== undefined) {
      hostConfig.RestartPolicy =
        typeof newConfig.restartPolicy === 'string'
          ? { Name: newConfig.restartPolicy, MaximumRetryCount: 0 }
          : newConfig.restartPolicy;
    }
    if (newConfig.memoryLimit !== undefined) hostConfig.Memory = Number(newConfig.memoryLimit) || 0;
    if (newConfig.cpuLimit !== undefined) {
      hostConfig.NanoCpus = newConfig.cpuLimit ? Math.round(Number(newConfig.cpuLimit) * 1e9) : 0;
    }
    if (newConfig.networkMode !== undefined) hostConfig.NetworkMode = newConfig.networkMode;
    if (newConfig.privileged !== undefined) hostConfig.Privileged = Boolean(newConfig.privileged);
    if (newConfig.devices !== undefined) hostConfig.Devices = newConfig.devices;
    if (newConfig.capAdd !== undefined) hostConfig.CapAdd = newConfig.capAdd;
    if (newConfig.extraHosts !== undefined) hostConfig.ExtraHosts = newConfig.extraHosts;

    // Mirror ExposedPorts from PortBindings so published ports work
    const exposed: Record<string, object> = { ...(config.ExposedPorts || {}) };
    for (const key of Object.keys(hostConfig.PortBindings || {})) {
      exposed[key] = {};
    }
    config.ExposedPorts = exposed;

    // Networking: primary network goes in NetworkingConfig; extras connected after create.
    // Strip runtime-only fields from EndpointSettings.
    const endpointFor = (net: any) => {
      const ep: any = {};
      if (net?.IPAMConfig) ep.IPAMConfig = net.IPAMConfig;
      if (Array.isArray(net?.Aliases)) {
        ep.Aliases = net.Aliases.filter((a: string) => !inspect.Id.startsWith(a));
      }
      if (Array.isArray(net?.Links)) ep.Links = net.Links;
      if (net?.NetworkID) ep.NetworkID = net.NetworkID;
      return ep;
    };

    const networkMode: string = hostConfig.NetworkMode || 'bridge';
    const networkNames = Object.keys(networks);
    const isSpecialMode = ['host', 'none'].includes(networkMode) || networkMode.startsWith('container:');
    let primaryNetwork: string | undefined;
    if (!isSpecialMode) {
      primaryNetwork = networkNames.includes(networkMode) ? networkMode : networkNames[0];
    }
    const extraNetworks = isSpecialMode ? [] : networkNames.filter((n) => n !== primaryNetwork);

    const createOptions: any = {
      ...config,
      name: targetName,
      HostConfig: hostConfig,
    };
    if (primaryNetwork) {
      createOptions.NetworkingConfig = {
        EndpointsConfig: { [primaryNetwork]: endpointFor(networks[primaryNetwork]) },
      };
    }
    // Docker defaults Hostname to the short container id; don't carry the old id over
    if (createOptions.Hostname && inspect.Id.startsWith(createOptions.Hostname)) {
      delete createOptions.Hostname;
    }

    // 1. Rename old container out of the way
    await container.rename({ name: tempName });

    let newContainer: Docker.Container | null = null;
    try {
      if (wasRunning) {
        await container.stop({ t: 10 });
      }

      // 2. Create new container
      newContainer = await this.docker.createContainer(createOptions);

      // 3. Attach extra networks
      for (const netName of extraNetworks) {
        try {
          await this.docker.getNetwork(netName).connect({
            Container: newContainer.id,
            EndpointConfig: endpointFor(networks[netName]),
          });
        } catch (netErr) {
          this.logger.warn('DOCKER', `Failed to connect ${targetName} to network ${netName}: ${netErr}`);
        }
      }

      // 4. Start new container
      await newContainer.start();

      // 5. Remove old container
      await container.remove({ force: true });

      this.logger.info('DOCKER', `Container ${oldName} recreated as ${newContainer.id.substring(0, 12)}`);
      return newContainer.id.substring(0, 12);
    } catch (error) {
      this.logger.error('DOCKER', `Failed to recreate container ${oldName}: ${error}`);
      // Roll back: drop the half-created container, restore the old one
      if (newContainer) {
        try {
          await newContainer.remove({ force: true });
        } catch {
          /* ignore */
        }
      }
      try {
        await container.rename({ name: oldName });
      } catch (renameErr) {
        this.logger.error('DOCKER', `Failed to rename ${tempName} back to ${oldName}: ${renameErr}`);
      }
      if (wasRunning) {
        try {
          await container.start();
        } catch {
          /* ignore */
        }
      }
      throw error;
    }
  }
}
