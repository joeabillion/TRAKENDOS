import si from 'systeminformation';
import { WebSocketServer, WebSocket } from 'ws';
import { EventLogger } from './eventLogger';

export interface CPUInfo {
  model: string;
  cores: number;
  threads: number;
  speed: number;
  temperature?: number;
}

export interface CPUUsage {
  currentLoad: number;
  currentLoadUser: number;
  currentLoadSystem: number;
  currentLoadIdle: number;
  rawCurrentLoad: number;
  rawCurrentLoadUser: number;
  rawCurrentLoadSystem: number;
  rawCurrentLoadIdle: number;
  cores: Array<{ load: number; loadUser: number; loadSystem: number; loadIdle: number }>;
  avgLoad: number;
  minLoad: number;
  maxLoad: number;
  history: Array<{ timestamp: number; load: number }>;
}

export interface MemoryInfo {
  total: number;
  free: number;
  used: number;
  active: number;
  available: number;
  buffers: number;
  cached: number;
  swapcached: number;
  swaptotal: number;
  swapfree: number;
  swapused: number;
}

export interface DiskInfo {
  device: string;
  type: string;
  size: number;
  used: number;
  available: number;
  use: number;
  mount: string;
  raidGroup?: string;
  temperature?: number;
  health?: string;
  serial?: string;
}

export interface GPUInfo {
  model: string;
  vram: number;
  vramUsed?: number;
  vramFree?: number;
  temperature?: number;
  utilization?: number;
  driver?: string;
}

export interface NetworkInterface {
  iface: string;
  ifaceSpeed: number | null;
  operstate: string;
  mtu: number;
  mac: string;
  ip4: string;
  ip4subnet: string;
  ip6: string;
  ip6subnet: string;
  type: string;
  duplex: string;
  speed: string | null;
}

export interface SystemOverview {
  cpu: CPUInfo;
  cpuUsage: CPUUsage;
  memory: MemoryInfo;
  disks: DiskInfo[];
  gpus: GPUInfo[];
  networkInterfaces: NetworkInterface[];
  osInfo: {
    platform: string;
    distro: string;
    release: string;
    kernel: string;
    arch: string;
    hostname: string;
  };
  uptime: number;
  timestamp: number;
}

export class SystemMonitor {
  private wss: WebSocketServer;
  private logger: EventLogger;
  private clients: Set<WebSocket> = new Set();
  private monitoringInterval: NodeJS.Timer | null = null;
  private cpuHistory: Array<{ timestamp: number; load: number }> = [];
  private readonly HISTORY_SIZE = 150; // 5 minutes of 2-second intervals

  constructor(wss: WebSocketServer, logger: EventLogger) {
    this.wss = wss;
    this.logger = logger;
  }

  start(): void {
    if (this.monitoringInterval) {
      return;
    }

    this.monitoringInterval = setInterval(() => {
      this.broadcastStats();
    }, 2000);

    this.logger.info('SYSTEM', 'System monitor started');
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.logger.info('SYSTEM', 'System monitor stopped');
  }

  registerClient(ws: WebSocket): void {
    this.clients.add(ws);

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', () => {
      this.clients.delete(ws);
    });
  }

  private broadcastStats(): void {
    this.getOverview().then((overview) => {
      const message = JSON.stringify({
        type: 'system:stats',
        data: overview,
      });

      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }

      // Pattern detection
      this.logger.detectSystemPatterns(overview);
    });
  }

  async getOverview(): Promise<SystemOverview> {
    try {
      const [cpu, cpuUsage, memory, disks, gpus, networkInterfaces, osInfo, uptime] = await Promise.all([
        si.cpu(),
        si.currentLoad(),
        si.mem(),
        si.diskLayout(),
        this.getGPUInfo(),
        si.networkInterfaces(),
        si.osInfo(),
        si.uptime(),
      ]);

      // Update CPU history
      this.cpuHistory.push({
        timestamp: Date.now(),
        load: cpuUsage.currentLoad,
      });

      if (this.cpuHistory.length > this.HISTORY_SIZE) {
        this.cpuHistory.shift();
      }

      const diskInfo = await this.enrichDiskInfo(disks);

      return {
        cpu: {
          model: cpu.brand,
          cores: cpu.cores,
          threads: cpu.threads,
          speed: cpu.speed,
        },
        cpuUsage: {
          currentLoad: cpuUsage.currentLoad,
          currentLoadUser: cpuUsage.currentLoadUser,
          currentLoadSystem: cpuUsage.currentLoadSystem,
          currentLoadIdle: cpuUsage.currentLoadIdle,
          rawCurrentLoad: cpuUsage.rawCurrentLoad,
          rawCurrentLoadUser: cpuUsage.rawCurrentLoadUser,
          rawCurrentLoadSystem: cpuUsage.rawCurrentLoadSystem,
          rawCurrentLoadIdle: cpuUsage.rawCurrentLoadIdle,
          cores: cpuUsage.cores,
          avgLoad: cpuUsage.avgLoad,
          minLoad: cpuUsage.minLoad,
          maxLoad: cpuUsage.maxLoad,
          history: this.cpuHistory,
        },
        memory,
        disks: diskInfo,
        gpus,
        networkInterfaces,
        osInfo,
        uptime,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error('SYSTEM', `Failed to get system overview: ${error}`);
      throw error;
    }
  }

  private async getGPUInfo(): Promise<GPUInfo[]> {
    try {
      const graphics = await si.graphics();
      return graphics.controllers.map((controller: any) => ({
        model: controller.model,
        vram: controller.vram,
        vramUsed: controller.vramUsed,
        vramFree: controller.vramFree,
        temperature: controller.temperatureGpu,
        utilization: undefined,
        driver: controller.driverVersion,
      }));
    } catch {
      return [];
    }
  }

  private async enrichDiskInfo(disks: any[]): Promise<DiskInfo[]> {
    try {
      const fsSize = await si.fsSize();

      return disks.map((disk) => {
        const fsInfo = fsSize.find((fs) => fs.fs.includes(disk.name));

        return {
          device: disk.name,
          type: disk.type,
          size: disk.size,
          used: fsInfo?.used || 0,
          available: fsInfo?.available || 0,
          use: fsInfo?.use || 0,
          mount: fsInfo?.mount || 'unknown',
          serial: disk.serial,
        };
      });
    } catch {
      return disks.map((disk) => ({
        device: disk.name,
        type: disk.type,
        size: disk.size,
        used: 0,
        available: 0,
        use: 0,
        mount: 'unknown',
        serial: disk.serial,
      }));
    }
  }

  async getCPUDetailed(): Promise<CPUUsage> {
    const cpuUsage = await si.currentLoad();

    return {
      currentLoad: cpuUsage.currentLoad,
      currentLoadUser: cpuUsage.currentLoadUser,
      currentLoadSystem: cpuUsage.currentLoadSystem,
      currentLoadIdle: cpuUsage.currentLoadIdle,
      rawCurrentLoad: cpuUsage.rawCurrentLoad,
      rawCurrentLoadUser: cpuUsage.rawCurrentLoadUser,
      rawCurrentLoadSystem: cpuUsage.rawCurrentLoadSystem,
      rawCurrentLoadIdle: cpuUsage.rawCurrentLoadIdle,
      cores: cpuUsage.cores,
      avgLoad: cpuUsage.avgLoad,
      minLoad: cpuUsage.minLoad,
      maxLoad: cpuUsage.maxLoad,
      history: this.cpuHistory,
    };
  }

  async getMemoryDetailed(): Promise<MemoryInfo> {
    return si.mem();
  }

  async getDisksDetailed(): Promise<DiskInfo[]> {
    const disks = await si.diskLayout();
    return this.enrichDiskInfo(disks);
  }

  async getNetworkDetailed(): Promise<any> {
    const [interfaces, stats] = await Promise.all([si.networkInterfaces(), si.networkStats()]);

    return {
      interfaces,
      stats,
    };
  }
}
