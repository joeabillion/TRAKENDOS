import si from 'systeminformation';
import { WebSocketServer, WebSocket } from 'ws';
import { EventLogger } from './eventLogger';
import { execSync } from 'child_process';

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
  private monitoringInterval: ReturnType<typeof setInterval> | null = null;
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
    this.getOverview().then(async (overview) => {
      // Transform to frontend's expected SystemStats format
      const frontendStats = {
        hostname: overview.osInfo.hostname,
        os: `${overview.osInfo.distro} ${overview.osInfo.release}`,
        kernel: overview.osInfo.kernel,
        uptime: overview.uptime,
        cpu: {
          model: overview.cpu.model,
          cores: overview.cpu.cores,
          threads: overview.cpu.threads,
          usage: overview.cpuUsage.currentLoad,
          perCoreUsage: overview.cpuUsage.cores.map((c: any) => c.load),
          temperature: overview.cpuUsage.cores.length > 0 ? 0 : 0, // si doesn't always provide per-CPU temp
          clockSpeed: overview.cpu.speed * 1000, // GHz to MHz
        },
        memory: {
          total: overview.memory.total,
          used: overview.memory.active || overview.memory.used,
          free: overview.memory.available || overview.memory.free,
          percent: overview.memory.total > 0 ? ((overview.memory.active || overview.memory.used) / overview.memory.total) * 100 : 0,
          buffered: overview.memory.buffers || 0,
          cached: overview.memory.cached || 0,
          available: overview.memory.available || 0,
          sticks: [],
        },
        storage: overview.disks.map((d: any) => ({
          name: d.device,
          size: d.size,
          used: d.used,
          temp: d.temperature || 0,
          health: d.health || 'good',
          type: d.type,
          readSpeed: 0,
          writeSpeed: 0,
        })),
        gpu: overview.gpus.map((g: any) => ({
          id: g.model,
          name: g.model,
          vramTotal: g.vram || 0,
          vramUsed: g.vramUsed || 0,
          temperature: g.temperature || 0,
          utilization: g.utilization || 0,
          driver: g.driver || '',
        })),
        network: (overview.networkInterfaces as any[]).filter((n: any) => n.ip4).map((n: any) => ({
          name: n.iface,
          ip: n.ip4,
          speed: n.ifaceSpeed || 0,
          rxBytes: 0,
          txBytes: 0,
          rxSpeed: 0,
          txSpeed: 0,
        })),
        docker: await this.getDockerStats(),
      };

      // Get CPU temperature from si
      si.cpuTemperature().then((temp: any) => {
        if (temp && temp.main) {
          frontendStats.cpu.temperature = temp.main;
        }

        const message = JSON.stringify({
          type: 'system-stats',
          payload: frontendStats,
        });

        for (const client of this.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        }
      }).catch(() => {
        const message = JSON.stringify({
          type: 'system-stats',
          payload: frontendStats,
        });

        for (const client of this.clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        }
      });

      // Pattern detection
      this.logger.detectSystemPatterns(overview);
    });
  }

  async getOverview(): Promise<SystemOverview> {
    try {
      const [cpu, cpuUsage, memory, disks, gpus, networkInterfaces, osInfo] = await Promise.all([
        si.cpu(),
        si.currentLoad(),
        si.mem(),
        si.diskLayout(),
        this.getGPUInfo(),
        si.networkInterfaces(),
        si.osInfo(),
      ]);
      const uptime = si.time().uptime;

      // Update CPU history
      this.cpuHistory.push({
        timestamp: Date.now(),
        load: cpuUsage.currentLoad,
      });

      if (this.cpuHistory.length > this.HISTORY_SIZE) {
        this.cpuHistory.shift();
      }

      const diskInfo = await this.enrichDiskInfo(disks);

      // Map cpus array to our cores format and compute min/max
      const coresData = (cpuUsage.cpus || []).map((c: any) => ({
        load: c.load,
        loadUser: c.loadUser,
        loadSystem: c.loadSystem,
        loadIdle: c.loadIdle,
      }));
      const coreLoads = coresData.map((c: any) => c.load);
      const minLoad = coreLoads.length > 0 ? Math.min(...coreLoads) : 0;
      const maxLoad = coreLoads.length > 0 ? Math.max(...coreLoads) : 0;

      return {
        cpu: {
          model: cpu.brand,
          cores: cpu.cores,
          threads: (cpu as any).threads || cpu.cores,
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
          cores: coresData,
          avgLoad: cpuUsage.avgLoad,
          minLoad,
          maxLoad,
          history: this.cpuHistory,
        },
        memory: { ...memory, swapcached: (memory as any).swapcached || 0 } as MemoryInfo,
        disks: diskInfo,
        gpus,
        networkInterfaces: networkInterfaces as unknown as NetworkInterface[],
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
    // Try nvidia-smi first for NVIDIA GPUs (works better for Tesla/datacenter cards)
    try {
      const nvsmi = execSync(
        'nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,temperature.gpu,utilization.gpu,driver_version --format=csv,noheader,nounits',
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      if (nvsmi) {
        return nvsmi.split('\n').map((line) => {
          const [model, vramTotal, vramUsed, vramFree, temp, util, driver] = line.split(', ').map(s => s.trim());
          return {
            model: model || 'Unknown GPU',
            vram: parseInt(vramTotal) || 0,
            vramUsed: parseInt(vramUsed) || 0,
            vramFree: parseInt(vramFree) || 0,
            temperature: parseInt(temp) || 0,
            utilization: parseInt(util) || 0,
            driver: driver || '',
          };
        });
      }
    } catch {
      // nvidia-smi not available, fall back to systeminformation
    }
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

  private async getDockerStats(): Promise<{ running: number; stopped: number; total: number }> {
    try {
      const out = execSync('docker ps -a --format "{{.State}}" 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }).trim();
      if (!out) return { running: 0, stopped: 0, total: 0 };
      const states = out.split('\n');
      const running = states.filter(s => s === 'running').length;
      const total = states.length;
      return { running, stopped: total - running, total };
    } catch {
      return { running: 0, stopped: 0, total: 0 };
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
    const coresData = (cpuUsage.cpus || []).map((c: any) => ({
      load: c.load,
      loadUser: c.loadUser,
      loadSystem: c.loadSystem,
      loadIdle: c.loadIdle,
    }));
    const coreLoads = coresData.map((c: any) => c.load);

    return {
      currentLoad: cpuUsage.currentLoad,
      currentLoadUser: cpuUsage.currentLoadUser,
      currentLoadSystem: cpuUsage.currentLoadSystem,
      currentLoadIdle: cpuUsage.currentLoadIdle,
      rawCurrentLoad: cpuUsage.rawCurrentLoad,
      rawCurrentLoadUser: cpuUsage.rawCurrentLoadUser,
      rawCurrentLoadSystem: cpuUsage.rawCurrentLoadSystem,
      rawCurrentLoadIdle: cpuUsage.rawCurrentLoadIdle,
      cores: coresData,
      avgLoad: cpuUsage.avgLoad,
      minLoad: coreLoads.length > 0 ? Math.min(...coreLoads) : 0,
      maxLoad: coreLoads.length > 0 ? Math.max(...coreLoads) : 0,
      history: this.cpuHistory,
    };
  }

  async getMemoryDetailed(): Promise<MemoryInfo> {
    const mem = await si.mem();
    return { ...mem, swapcached: (mem as any).swapcached || 0 } as MemoryInfo;
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
