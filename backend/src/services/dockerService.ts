import Docker from 'dockerode';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EventLogger } from './eventLogger';

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
  private execSessions: Map<string, { containerId: string; exec: any }> = new Map();

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
      const stream = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
        tail: lines,
        timestamps,
      });

      return new Promise((resolve, reject) => {
        let logs = '';
        const readable = stream as unknown as NodeJS.ReadableStream;
        readable.on('data', (chunk: any) => {
          logs += chunk.toString();
        });
        readable.on('end', () => resolve(logs));
        readable.on('error', reject);
      });
    } catch (error) {
      this.logger.error('DOCKER', `Failed to get container logs: ${error}`);
      throw error;
    }
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
        const dfOutput = execSync('docker system df --format "{{json .}}"', { encoding: 'utf-8' });
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
        dataRoot: daemonConfig['data-root'] || '/var/lib/docker',
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
        daemonConfig['data-root'] = settings.dataRoot;
      }
      if (settings.logDriver) {
        daemonConfig['log-driver'] = settings.logDriver;
      }
      if (settings.storageDriver) {
        daemonConfig['storage-driver'] = settings.storageDriver;
      }
      if (settings.otherSettings) {
        daemonConfig = { ...daemonConfig, ...settings.otherSettings };
      }

      // Write back
      fs.writeFileSync(daemonConfigPath, JSON.stringify(daemonConfig, null, 2));

      // Restart Docker
      try {
        execSync('systemctl restart docker', { encoding: 'utf-8' });
        this.logger.info('DOCKER', 'Docker daemon restarted after settings update');
      } catch (restartError) {
        this.logger.warn('DOCKER', `Failed to restart docker: ${restartError}`);
      }
    } catch (error) {
      this.logger.error('DOCKER', `Failed to update Docker settings: ${error}`);
      throw error;
    }
  }

  async migrateStorage(newPath: string, onProgress?: (message: string) => void): Promise<void> {
    try {
      const progressLog = (msg: string) => {
        this.logger.info('DOCKER', msg);
        if (onProgress) {
          onProgress(msg);
        }
      };

      const daemonConfigPath = '/etc/docker/daemon.json';
      let daemonConfig: any = {};

      if (fs.existsSync(daemonConfigPath)) {
        try {
          const content = fs.readFileSync(daemonConfigPath, 'utf-8');
          daemonConfig = JSON.parse(content);
        } catch {
          // Start with empty
        }
      }

      const oldPath = daemonConfig['data-root'] || '/var/lib/docker';

      progressLog(`Starting Docker storage migration from ${oldPath} to ${newPath}`);

      // Stop all containers
      progressLog('Stopping all containers...');
      try {
        execSync('docker stop $(docker ps -aq)', { encoding: 'utf-8' });
      } catch {
        // No containers running or already stopped
      }

      // Stop Docker daemon
      progressLog('Stopping Docker daemon...');
      execSync('systemctl stop docker docker.socket', { encoding: 'utf-8' });

      // Create target directory if needed
      progressLog(`Creating target directory: ${newPath}`);
      if (!fs.existsSync(newPath)) {
        fs.mkdirSync(newPath, { recursive: true });
      }

      // Rsync data
      progressLog(`Syncing data from ${oldPath} to ${newPath}...`);
      execSync(`rsync -aHAX "${oldPath}/" "${newPath}/"`, { encoding: 'utf-8', stdio: 'pipe' });

      // Update daemon.json
      progressLog('Updating daemon.json...');
      daemonConfig['data-root'] = newPath;
      fs.writeFileSync(daemonConfigPath, JSON.stringify(daemonConfig, null, 2));

      // Start Docker daemon
      progressLog('Starting Docker daemon...');
      execSync('systemctl start docker docker.socket', { encoding: 'utf-8' });

      // Verify
      progressLog('Verifying containers...');
      try {
        execSync('docker ps -a', { encoding: 'utf-8' });
        progressLog('Docker storage migration completed successfully');
      } catch (verifyError) {
        throw new Error(`Verification failed: ${verifyError}`);
      }
    } catch (error) {
      this.logger.error('DOCKER', `Failed to migrate storage: ${error}`);
      throw error;
    }
  }

  async fullBackup(destPath: string, onProgress?: (message: string) => void): Promise<string> {
    try {
      const progressLog = (msg: string) => {
        this.logger.info('DOCKER', msg);
        if (onProgress) {
          onProgress(msg);
        }
      };

      // Ensure destination directory exists
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }

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
      const imagesOutput = execSync('docker images --format "{{.Repository}}:{{.Tag}}"', { encoding: 'utf-8' });
      const images = imagesOutput.trim().split('\n').filter((img: string) => img && img !== '<none>:<none>');

      for (const image of images) {
        try {
          progressLog(`Saving image: ${image}`);
          const imageSafeName = image.replace(/[/:]/g, '_');
          const imageFile = path.join(backupDir, `image_${imageSafeName}.tar`);
          execSync(`docker save "${image}" -o "${imageFile}"`, { encoding: 'utf-8', stdio: 'pipe' });
          manifest.images.push({ name: image, file: `image_${imageSafeName}.tar` });
        } catch (imageError) {
          this.logger.warn('DOCKER', `Failed to save image ${image}: ${imageError}`);
        }
      }

      // Backup all containers
      progressLog('Backing up container configurations...');
      const containersOutput = execSync('docker ps -a --format "{{.ID}}"', { encoding: 'utf-8' });
      const containers = containersOutput.trim().split('\n').filter((id: string) => id);

      for (const containerId of containers) {
        try {
          progressLog(`Backing up container: ${containerId}`);
          const inspectOutput = execSync(`docker inspect "${containerId}"`, { encoding: 'utf-8' });
          const containerConfig = JSON.parse(inspectOutput)[0];
          const containerName = containerConfig.Name.replace(/^\//, '');
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
      const volumesOutput = execSync('docker volume ls --format "{{.Name}}"', { encoding: 'utf-8' });
      const volumes = volumesOutput.trim().split('\n').filter((vol: string) => vol);

      const volumesDir = path.join(backupDir, 'volumes');
      fs.mkdirSync(volumesDir, { recursive: true });

      for (const volumeName of volumes) {
        try {
          progressLog(`Backing up volume: ${volumeName}`);
          const volumeMount = execSync(`docker volume inspect "${volumeName}" --format '{{.Mountpoint}}'`, {
            encoding: 'utf-8',
          }).trim();
          if (volumeMount && fs.existsSync(volumeMount)) {
            execSync(`rsync -aHAX "${volumeMount}/" "${path.join(volumesDir, volumeName)}/"`, {
              encoding: 'utf-8',
              stdio: 'pipe',
            });
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
      execSync(`tar -czf "${backupPath}" -C "${path.dirname(backupDir)}" "${backupName}"`, {
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      // Cleanup temporary directory
      execSync(`rm -rf "${backupDir}"`, { encoding: 'utf-8' });

      progressLog(`Backup completed: ${backupPath}`);
      return backupPath;
    } catch (error) {
      this.logger.error('DOCKER', `Failed to create full backup: ${error}`);
      throw error;
    }
  }

  async fullRestore(backupPath: string, onProgress?: (message: string) => void): Promise<void> {
    try {
      const progressLog = (msg: string) => {
        this.logger.info('DOCKER', msg);
        if (onProgress) {
          onProgress(msg);
        }
      };

      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`);
      }

      progressLog('Extracting backup...');
      const tempDir = path.join('/tmp', `docker-restore-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      execSync(`tar -xzf "${backupPath}" -C "${tempDir}"`, { encoding: 'utf-8', stdio: 'pipe' });

      // Find the extracted backup directory
      const files = fs.readdirSync(tempDir);
      const backupDir = path.join(tempDir, files[0]);

      // Read manifest
      progressLog('Reading manifest...');
      const manifestPath = path.join(backupDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Manifest not found in backup');
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      // Restore images
      progressLog('Restoring Docker images...');
      for (const image of manifest.images || []) {
        try {
          const imageFile = path.join(backupDir, image.file);
          if (fs.existsSync(imageFile)) {
            progressLog(`Loading image: ${image.name}`);
            execSync(`docker load -i "${imageFile}"`, { encoding: 'utf-8', stdio: 'pipe' });
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
            progressLog(`Creating volume: ${volumeName}`);
            execSync(`docker volume create "${volumeName}"`, { encoding: 'utf-8' });

            const volumeMount = execSync(`docker volume inspect "${volumeName}" --format '{{.Mountpoint}}'`, {
              encoding: 'utf-8',
            }).trim();

            const sourceVolume = path.join(volumesDir, volumeName);
            if (fs.existsSync(sourceVolume)) {
              progressLog(`Restoring volume data: ${volumeName}`);
              execSync(`rsync -aHAX "${sourceVolume}/" "${volumeMount}/"`, {
                encoding: 'utf-8',
                stdio: 'pipe',
              });
            }
          } catch (volError) {
            this.logger.warn('DOCKER', `Failed to restore volume ${volumeName}: ${volError}`);
          }
        }
      }

      // Restore containers (just create them from config)
      progressLog('Restoring containers...');
      for (const container of manifest.containers || []) {
        try {
          const configFile = path.join(backupDir, container.configFile);
          if (fs.existsSync(configFile)) {
            progressLog(`Restoring container: ${container.name}`);
            const containerConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
            // Note: Full container restoration would require more complex logic
            // For now, we log this as informational
            this.logger.info('DOCKER', `Container ${container.name} config available for manual recreation`);
          }
        } catch (containerError) {
          this.logger.warn('DOCKER', `Failed to restore container ${container.name}: ${containerError}`);
        }
      }

      // Cleanup
      progressLog('Cleaning up temporary files...');
      execSync(`rm -rf "${tempDir}"`, { encoding: 'utf-8' });

      progressLog('Restore completed');
    } catch (error) {
      this.logger.error('DOCKER', `Failed to restore from backup: ${error}`);
      throw error;
    }
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

      // Try bash first, fall back to sh
      const cmd = ['/bin/bash', '-l'];

      const execOptions = {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: cmd,
      };

      const exec = await container.exec(execOptions);

      // Generate a unique exec session ID
      const execId = exec.id;

      // Store the exec session
      this.execSessions.set(execId, { containerId, exec });

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

  getExecSession(execId: string): { containerId: string; exec: any } | undefined {
    return this.execSessions.get(execId);
  }

  closeExecSession(execId: string): void {
    this.execSessions.delete(execId);
  }

  async recreateContainer(containerId: string, newConfig: any): Promise<string> {
    try {
      const container = this.docker.getContainer(containerId);
      const inspect = await container.inspect();
      const oldName = inspect.Name.replace(/^\//, '');

      // Stop if running
      if (inspect.State.Running) {
        await container.stop({ t: 10 });
      }

      // Remove old container
      await container.remove({ force: true });

      // Merge old config with new config
      const hostConfig = inspect.HostConfig || {};
      const createConfig: any = {
        name: newConfig.name || oldName,
        Image: newConfig.image || inspect.Config.Image,
        Cmd: newConfig.cmd || inspect.Config.Cmd,
        Env: newConfig.env || inspect.Config.Env,
        ExposedPorts: {},
        HostConfig: {
          PortBindings: newConfig.portBindings || hostConfig.PortBindings || {},
          Binds: newConfig.binds || hostConfig.Binds || [],
          RestartPolicy: newConfig.restartPolicy || hostConfig.RestartPolicy || { Name: 'no' },
          Memory: newConfig.memoryLimit || hostConfig.Memory || 0,
          NanoCpus: newConfig.cpuLimit ? Math.round(newConfig.cpuLimit * 1e9) : (hostConfig.NanoCpus || 0),
          NetworkMode: newConfig.networkMode || hostConfig.NetworkMode || 'bridge',
        },
      };

      // Build ExposedPorts from PortBindings
      if (createConfig.HostConfig.PortBindings) {
        for (const key of Object.keys(createConfig.HostConfig.PortBindings)) {
          createConfig.ExposedPorts[key] = {};
        }
      }

      const newContainer = await this.docker.createContainer(createConfig);
      await newContainer.start();

      this.logger.info('DOCKER', `Container ${oldName} recreated as ${newContainer.id.substring(0, 12)}`);
      return newContainer.id.substring(0, 12);
    } catch (error) {
      this.logger.error('DOCKER', `Failed to recreate container ${containerId}: ${error}`);
      throw error;
    }
  }
}
