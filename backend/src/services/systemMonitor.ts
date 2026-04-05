import si from 'systeminformation';
import { WebSocketServer, WebSocket } from 'ws';
import { EventLogger } from './eventLogger';
import { execSync } from 'child_process';
import Docker from 'dockerode';

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
      // Gather extra data in parallel
      const [cpuTemp, processes, disksIO, networkStats, dockerContainers, sensors] = await Promise.all([
        si.cpuTemperature().catch(() => ({ main: 0, cores: [], max: 0 })),
        si.processes().catch(() => ({ all: 0, running: 0, blocked: 0, sleeping: 0, list: [] })),
        si.disksIO().catch(() => ({ rIO_sec: 0, wIO_sec: 0, rWaitTime: 0, wWaitTime: 0 })),
        si.networkStats().catch(() => []),
        this.getDockerContainerDetails(),
        this.getSensorData(),
      ]);

      // Build network stats map for rx/tx speeds
      const netStatsMap: Record<string, any> = {};
      if (Array.isArray(networkStats)) {
        for (const ns of networkStats) { netStatsMap[ns.iface] = ns; }
      }

      // Top processes by CPU
      const topProcesses = (processes.list || [])
        .sort((a: any, b: any) => (b.cpu || 0) - (a.cpu || 0))
        .slice(0, 15)
        .map((p: any) => ({
          pid: p.pid,
          name: p.name,
          cpu: p.cpu || 0,
          mem: p.mem || 0,
          memRss: p.memRss || 0,
          state: p.state || '',
          user: p.user || '',
        }));

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
          temperature: (cpuTemp as any).main || 0,
          clockSpeed: overview.cpu.speed * 1000,
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
          swapTotal: overview.memory.swaptotal || 0,
          swapUsed: overview.memory.swapused || 0,
          swapFree: overview.memory.swapfree || 0,
        },
        storage: overview.disks.map((d: any) => ({
          name: d.device,
          size: d.size,
          used: d.used,
          temp: d.temperature || 0,
          health: d.health || 'good',
          type: d.type,
          mount: d.mount || '',
          serial: d.serial || '',
          role: d.role || '',
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
        network: (overview.networkInterfaces as any[]).filter((n: any) => n.ip4).map((n: any) => {
          const ns = netStatsMap[n.iface];
          return {
            name: n.iface,
            ip: n.ip4,
            speed: n.ifaceSpeed || 0,
            rxBytes: ns?.rx_bytes || 0,
            txBytes: ns?.tx_bytes || 0,
            rxSpeed: ns?.rx_sec || 0,
            txSpeed: ns?.tx_sec || 0,
          };
        }),
        docker: await this.getDockerStats(),
        // NEW: extended data
        processes: {
          total: processes.all || 0,
          running: processes.running || 0,
          blocked: processes.blocked || 0,
          sleeping: processes.sleeping || 0,
          list: topProcesses,
        },
        diskIO: {
          readPerSec: (disksIO as any).rIO_sec || 0,
          writePerSec: (disksIO as any).wIO_sec || 0,
          readBytesPerSec: (disksIO as any).rIO_sec || 0,
          writeBytesPerSec: (disksIO as any).wIO_sec || 0,
        },
        temperatures: {
          cpu: (cpuTemp as any).main || 0,
          cpuCores: (cpuTemp as any).cores || [],
          cpuMax: (cpuTemp as any).max || 0,
          sensors: sensors,
        },
        dockerContainers: dockerContainers,
      };

      const message = JSON.stringify({ type: 'system-stats', payload: frontendStats });
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      }

      this.logger.detectSystemPatterns(overview);
    });
  }

  private async getDockerContainerDetails(): Promise<any[]> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const containers = await docker.listContainers({ all: true });
      return containers.map((c: any) => ({
        id: c.Id?.slice(0, 12) || '',
        name: (c.Names?.[0] || '').replace('/', ''),
        image: c.Image || '',
        state: c.State || '',
        status: c.Status || '',
        ports: (c.Ports || []).map((p: any) => `${p.PublicPort || ''}:${p.PrivatePort || ''}`).filter((p: string) => p !== ':'),
      }));
    } catch {
      return [];
    }
  }

  private async getSensorData(): Promise<any[]> {
    try {
      const { execSync } = require('child_process');
      const raw = execSync('sensors -j 2>/dev/null || true', { encoding: 'utf-8', timeout: 3000 });
      if (!raw.trim()) return [];
      const parsed = JSON.parse(raw);
      const sensors: any[] = [];
      for (const [chip, data] of Object.entries(parsed)) {
        if (typeof data !== 'object' || !data) continue;
        for (const [label, readings] of Object.entries(data as any)) {
          if (typeof readings !== 'object' || !readings) continue;
          for (const [key, val] of Object.entries(readings as any)) {
            if (key.includes('_input') && typeof val === 'number') {
              const type = key.includes('fan') ? 'fan' : key.includes('temp') ? 'temp' : key.includes('in') ? 'voltage' : 'other';
              sensors.push({ chip, label, type, value: val, unit: type === 'fan' ? 'RPM' : type === 'temp' ? '°C' : 'V' });
            }
          }
        }
      }
      return sensors;
    } catch {
      return [];
    }
  }

  async getOverview(): Promise<SystemOverview> {
    try {
      const [cpu, cpuUsage, memory, disks, gpus, networkInterfaces, osInfo] = await Promise.all([
        si.cpu(),
        si.currentLoad(),
        si.mem(),
        this.safeDiskLayout(),
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
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const containers = await docker.listContainers({ all: true });
      const total = containers.length;
      const running = containers.filter((c: any) => c.State === 'running').length;
      return { running, stopped: total - running, total };
    } catch (err) {
      this.logger.debug('SYSTEM', `Docker stats failed: ${err}`);
      return { running: 0, stopped: 0, total: 0 };
    }
  }

  private async enrichDiskInfo(disks: any[]): Promise<DiskInfo[]> {
    try {
      const fsSize = await si.fsSize();
      const blockDevices = await si.blockDevices();

      // Build a map: physical disk device -> best mount point + usage
      // blockDevices tells us which partitions belong to which disk
      // fsSize tells us mount points and usage per partition
      const enriched: DiskInfo[] = disks.map((disk) => {
        const diskName = (disk.device || disk.name || '').replace('/dev/', '');

        // Find filesystem entries that belong to this physical disk
        // e.g. disk.device = '/dev/sda', fsSize has '/dev/sda1', '/dev/sda2' etc.
        let bestFs: any = null;
        let bestMount = 'unknown';

        for (const fs of fsSize) {
          const fsDevice = (fs.fs || '').replace('/dev/', '');
          // Match: sda1 starts with sda, or md0 matches md0, or dm-0 etc.
          if (fsDevice.startsWith(diskName) || diskName.startsWith(fsDevice)) {
            // Prefer the largest or root partition
            if (!bestFs || fs.mount === '/' || fs.size > (bestFs.size || 0)) {
              bestFs = fs;
              bestMount = fs.mount;
            }
          }
        }

        // Also check blockDevices for mount info
        if (bestMount === 'unknown') {
          for (const bd of blockDevices) {
            const bdName = (bd.name || '').replace('/dev/', '');
            if (bdName.startsWith(diskName) || diskName.startsWith(bdName)) {
              if (bd.mount && bd.mount !== '') {
                bestMount = bd.mount;
                // Try to find matching fsSize for usage data
                bestFs = fsSize.find(f => f.mount === bd.mount) || bestFs;
                break;
              }
            }
          }
        }

        // Detect role from mount path or device name
        let role = '';
        const mountLower = bestMount.toLowerCase();
        const nameLower = diskName.toLowerCase();
        if (mountLower.includes('parity') || nameLower.includes('parity')) {
          role = 'parity';
        } else if (mountLower.includes('cache') || nameLower.includes('cache') || disk.type === 'SSD' || disk.type === 'NVMe') {
          // NVMe/SSD drives are typically cache in unraid-like setups
          if (mountLower.includes('cache') || mountLower.includes('/mnt/cache')) {
            role = 'cache';
          }
        }
        if (mountLower.match(/\/mnt\/disks?\/disk\d+/) || mountLower.match(/\/mnt\/disk\d+/)) {
          role = 'data';
        }
        if (mountLower === '/' || mountLower === '/boot' || mountLower === '/boot/efi') {
          role = 'os';
        }

        return {
          device: disk.device || disk.name,
          type: disk.type,
          size: disk.size,
          used: bestFs?.used || 0,
          available: bestFs?.available || 0,
          use: bestFs?.use || 0,
          mount: bestMount,
          serial: disk.serial || '',
          role,
        };
      });

      return enriched;
    } catch (err) {
      this.logger.debug('SYSTEM', `enrichDiskInfo error: ${err}`);
      return disks.map((disk) => ({
        device: disk.device || disk.name,
        type: disk.type,
        size: disk.size,
        used: 0,
        available: 0,
        use: 0,
        mount: 'unknown',
        serial: disk.serial || '',
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

  private async safeDiskLayout(): Promise<any[]> {
    try {
      const timeout = new Promise<any[]>((_, reject) =>
        setTimeout(() => reject(new Error('diskLayout timeout')), 10000)
      );
      return await Promise.race([si.diskLayout(), timeout]);
    } catch {
      return this.lastDiskLayout || [];
    }
  }

  private lastDiskLayout: any[] = [];

  async getDisksDetailed(): Promise<DiskInfo[]> {
    const disks = await this.safeDiskLayout();
    this.lastDiskLayout = disks;
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
