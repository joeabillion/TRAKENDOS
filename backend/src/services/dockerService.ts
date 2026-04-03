import Docker from 'dockerode';
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

export class DockerService {
  private docker: Docker;
  private logger: EventLogger;
  private statsCache: Map<string, any> = new Map();

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

      return images.map((image) => ({
        id: image.Id.substring(7, 19), // Remove sha256: prefix
        repoTags: image.RepoTags || [],
        size: image.Size,
        created: image.Created * 1000,
        virtualSize: image.VirtualSize,
      }));
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

      return (result.Volumes || []).map((volume) => ({
        name: volume.Name,
        driver: volume.Driver,
        mountpoint: volume.Mountpoint,
        labels: volume.Labels || {},
        options: volume.Options || {},
      }));
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
}
