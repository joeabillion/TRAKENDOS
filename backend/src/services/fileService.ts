import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventLogger } from './eventLogger';

const execAsync = promisify(exec);

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modified: string;
  created: string;
  permissions: string;
  owner: string;
  group: string;
  extension: string;
  hidden: boolean;
  readable: boolean;
  writable: boolean;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
  totalFiles: number;
  totalDirs: number;
  totalSize: number;
}

export interface DiskMount {
  device: string;
  mountpoint: string;
  fstype: string;
  size: number;
  used: number;
  available: number;
  usePercent: number;
  label: string;
}

export interface FileSearchResult {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
  matchContext?: string;
}

export class FileService {
  private logger: EventLogger;

  // Paths that should never be browsable
  private readonly BLOCKED_PATHS = [
    '/proc', '/sys', '/dev', '/run/lock',
  ];

  // System directories hidden from root listing (still accessible if navigated directly)
  private readonly HIDDEN_ROOT_DIRS = [
    'boot', 'bin', 'dev', 'etc', 'lib', 'lib32', 'lib64', 'libx32',
    'proc', 'root', 'run', 'sbin', 'snap', 'srv', 'sys', 'tmp', 'usr', 'var',
    'lost+found', 'swap.img', 'initrd.img', 'initrd.img.old', 'vmlinuz', 'vmlinuz.old',
  ];

  // System-critical paths that cannot be deleted, moved, or modified
  private readonly PROTECTED_PATHS = [
    // Root filesystem
    '/', '/boot', '/boot/efi', '/etc', '/usr', '/var', '/bin', '/sbin', '/lib', '/lib64',
    '/root', '/tmp', '/run', '/opt',
    // Trakend OS application
    '/opt/trakend', '/opt/trakend/os', '/opt/trakend/os/backend', '/opt/trakend/os/frontend',
    '/opt/trakend/os/package.json', '/opt/trakend/os/backend/package.json',
    // System config
    '/etc/fstab', '/etc/hostname', '/etc/hosts', '/etc/passwd', '/etc/shadow', '/etc/group',
    '/etc/sudoers', '/etc/ssh', '/etc/systemd', '/etc/docker', '/etc/nginx', '/etc/samba',
    '/etc/network', '/etc/netplan', '/etc/resolv.conf', '/etc/default/grub',
    // Docker
    '/var/run/docker.sock', '/etc/docker/daemon.json',
    // Data & database directories
    '/data', '/data/db',
    // Mount points (top-level only)
    '/mnt', '/mnt/disks', '/mnt/disks/disk1', '/mnt/disks/disk2', '/mnt/disks/cache',
    '/mnt/user',
    // Systemd services
    '/etc/systemd/system/trakend-os.service',
    '/etc/systemd/system/docker.service',
    // GRUB / Boot
    '/boot/grub', '/boot/grub/grub.cfg', '/boot/vmlinuz', '/boot/initrd.img',
  ];

  /**
   * Check if a path is protected from modification/deletion
   */
  isProtected(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    // Exact match
    if (this.PROTECTED_PATHS.includes(resolved)) return true;
    // Direct children of critical root dirs (e.g. /etc/anything, /usr/anything)
    const criticalRoots = ['/', '/boot', '/etc', '/usr', '/var', '/bin', '/sbin', '/lib', '/lib64', '/opt/trakend/os'];
    for (const root of criticalRoots) {
      if (resolved === root) return true;
      // Protect the root dir itself but also first-level children of / (e.g. /home is fine to browse but not delete)
      if (root === '/' && resolved.split('/').filter(Boolean).length === 1) return true;
    }
    return false;
  }

  constructor(logger: EventLogger) {
    this.logger = logger;
  }

  /**
   * List all mounted filesystems / drives
   * Uses findmnt (reliable) + df (for size info) + /mnt/disks scan (catch array drives)
   */
  async getMounts(): Promise<DiskMount[]> {
    const mountMap = new Map<string, DiskMount>(); // keyed by mountpoint to dedup

    const SKIP_FS = new Set([
      'tmpfs', 'devtmpfs', 'sysfs', 'proc', 'cgroup', 'cgroup2',
      'securityfs', 'pstore', 'efivarfs', 'bpf', 'debugfs',
      'tracefs', 'hugetlbfs', 'mqueue', 'fusectl', 'configfs',
      'overlay', 'squashfs', 'autofs', 'devpts', 'nsfs',
    ]);
    const SKIP_MOUNTS = new Set(['/boot', '/boot/efi']);

    // Helper: get a human-readable label for a mount
    const getLabel = async (device: string, mountpoint: string): Promise<string> => {
      // Try blkid label
      try {
        const { stdout: lbl } = await execAsync(`blkid -s LABEL -o value ${device} 2>/dev/null`);
        if (lbl.trim()) return lbl.trim();
      } catch { /* no label */ }
      // Fallback smart labels
      if (mountpoint === '/') return 'System';
      if (mountpoint === '/data') return 'Data';
      if (mountpoint.startsWith('/mnt/disks/')) {
        const name = path.basename(mountpoint);
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
      if (mountpoint.startsWith('/mnt/')) {
        const name = path.basename(mountpoint);
        return name.charAt(0).toUpperCase() + name.slice(1);
      }
      return path.basename(mountpoint) || device;
    };

    // Helper: get size info from df for a mountpoint
    const getDfInfo = async (mountpoint: string): Promise<{ size: number; used: number; available: number; usePercent: number }> => {
      try {
        const { stdout } = await execAsync(`df -B1 "${mountpoint}" 2>/dev/null | tail -1`);
        const parts = stdout.trim().split(/\s+/);
        if (parts.length >= 5) {
          const size = parseInt(parts[1]) || 0;
          const used = parseInt(parts[2]) || 0;
          const available = parseInt(parts[3]) || 0;
          const usePercent = size > 0 ? Math.round((used / size) * 100) : 0;
          return { size, used, available, usePercent };
        }
      } catch { /* ignore */ }
      return { size: 0, used: 0, available: 0, usePercent: 0 };
    };

    try {
      // ── Method 1: findmnt (most reliable) ──
      try {
        const { stdout: findmntOut } = await execAsync(
          'findmnt -r -n -o SOURCE,TARGET,FSTYPE 2>/dev/null'
        );
        for (const line of findmntOut.trim().split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 3) continue;
          const [device, mountpoint, fstype] = parts;
          if (SKIP_FS.has(fstype)) continue;
          if (SKIP_MOUNTS.has(mountpoint)) continue;
          if (device.startsWith('none') || device === 'udev') continue;
          // Only include real block devices and /data, /mnt paths, /
          if (!device.startsWith('/dev/')) continue;

          const dfInfo = await getDfInfo(mountpoint);
          const label = await getLabel(device, mountpoint);

          mountMap.set(mountpoint, {
            device, mountpoint, fstype,
            size: dfInfo.size,
            used: dfInfo.used,
            available: dfInfo.available,
            usePercent: dfInfo.usePercent,
            label,
          });
        }
      } catch {
        this.logger.warn('FILES', 'findmnt failed, falling back to df');
      }

      // ── Method 2: df fallback (adds anything findmnt missed) ──
      try {
        const { stdout: dfOut } = await execAsync(
          "df -BK --output=source,target,fstype,size,used,avail,pcent 2>/dev/null | tail -n +2"
        );
        const parseKB = (s: string) => parseInt(s.replace(/K$/, '')) * 1024 || 0;
        for (const line of dfOut.trim().split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 7) continue;
          const [device, mountpoint, fstype] = parts;
          if (SKIP_FS.has(fstype)) continue;
          if (SKIP_MOUNTS.has(mountpoint)) continue;
          if (device.startsWith('none') || device === 'udev') continue;
          if (mountMap.has(mountpoint)) continue; // already found by findmnt

          const label = await getLabel(device, mountpoint);
          mountMap.set(mountpoint, {
            device, mountpoint, fstype,
            size: parseKB(parts[3]),
            used: parseKB(parts[4]),
            available: parseKB(parts[5]),
            usePercent: parseInt(parts[6].replace('%', '')) || 0,
            label,
          });
        }
      } catch { /* ignore */ }

      // ── Method 3: scan /mnt/disks/* directly (catch array drives) ──
      try {
        const disksDir = '/mnt/disks';
        if (fs.existsSync(disksDir)) {
          const entries = fs.readdirSync(disksDir);
          for (const entry of entries) {
            const mp = path.join(disksDir, entry);
            if (mountMap.has(mp)) continue; // already found
            try {
              const stat = fs.statSync(mp);
              if (!stat.isDirectory()) continue;
              // Check if it's actually a mountpoint
              const { stdout: src } = await execAsync(`findmnt -n -o SOURCE,FSTYPE "${mp}" 2>/dev/null`);
              if (!src.trim()) continue;
              const [device, fstype] = src.trim().split(/\s+/);
              const dfInfo = await getDfInfo(mp);
              const label = await getLabel(device || '', mp);
              mountMap.set(mp, {
                device: device || 'unknown',
                mountpoint: mp,
                fstype: fstype || 'unknown',
                size: dfInfo.size,
                used: dfInfo.used,
                available: dfInfo.available,
                usePercent: dfInfo.usePercent,
                label,
              });
            } catch { /* not a mountpoint */ }
          }
        }
      } catch { /* ignore */ }

    } catch (error) {
      this.logger.error('FILES', `Failed to get mounts: ${error}`);
    }

    // Convert to array and sort
    const mounts = Array.from(mountMap.values());
    mounts.sort((a, b) => {
      const priority = (m: DiskMount) => {
        if (m.mountpoint.startsWith('/mnt/disks/')) return 0;
        if (m.mountpoint === '/data') return 1;
        if (m.mountpoint.startsWith('/mnt/')) return 2;
        if (m.mountpoint === '/') return 3;
        return 4;
      };
      return priority(a) - priority(b);
    });

    return mounts;
  }

  /**
   * List directory contents
   */
  async listDirectory(dirPath: string, showHidden = false): Promise<DirectoryListing> {
    const resolvedPath = path.resolve(dirPath);

    // Security check
    if (this.BLOCKED_PATHS.some(bp => resolvedPath.startsWith(bp))) {
      throw new Error(`Access denied: ${resolvedPath} is a restricted path`);
    }

    // Check directory exists
    const stat = await fsp.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${resolvedPath}`);
    }

    const rawEntries = await fsp.readdir(resolvedPath, { withFileTypes: true });
    const entries: FileEntry[] = [];
    let totalSize = 0;
    let totalFiles = 0;
    let totalDirs = 0;

    for (const dirent of rawEntries) {
      // Skip hidden files unless requested
      if (!showHidden && dirent.name.startsWith('.')) continue;

      // Hide system directories when browsing root
      if (resolvedPath === '/' && this.HIDDEN_ROOT_DIRS.includes(dirent.name)) continue;

      const fullPath = path.join(resolvedPath, dirent.name);

      try {
        const fileStat = await fsp.lstat(fullPath);

        let type: FileEntry['type'] = 'other';
        if (fileStat.isDirectory()) { type = 'directory'; totalDirs++; }
        else if (fileStat.isSymbolicLink()) { type = 'symlink'; }
        else if (fileStat.isFile()) { type = 'file'; totalFiles++; totalSize += fileStat.size; }

        // Get ownership
        let owner = String(fileStat.uid);
        let group = String(fileStat.gid);
        try {
          const { stdout: ow } = await execAsync(`stat -c '%U:%G' "${fullPath}" 2>/dev/null`);
          const parts = ow.trim().split(':');
          if (parts.length === 2) { owner = parts[0]; group = parts[1]; }
        } catch { /* keep numeric */ }

        // Check access
        let readable = true;
        let writable = true;
        try { await fsp.access(fullPath, fs.constants.R_OK); } catch { readable = false; }
        try { await fsp.access(fullPath, fs.constants.W_OK); } catch { writable = false; }

        entries.push({
          name: dirent.name,
          path: fullPath,
          type,
          size: fileStat.size,
          modified: fileStat.mtime.toISOString(),
          created: fileStat.birthtime.toISOString(),
          permissions: this.formatPermissions(fileStat.mode),
          owner,
          group,
          extension: type === 'file' ? path.extname(dirent.name).toLowerCase() : '',
          hidden: dirent.name.startsWith('.'),
          readable,
          writable,
        });
      } catch {
        // Skip files we can't stat
      }
    }

    // Sort: directories first, then files, alphabetically
    entries.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    const parent = resolvedPath === '/' ? null : path.dirname(resolvedPath);

    return {
      path: resolvedPath,
      parent,
      entries,
      totalFiles,
      totalDirs,
      totalSize,
    };
  }

  /**
   * Get file info
   */
  async getFileInfo(filePath: string): Promise<FileEntry> {
    const resolvedPath = path.resolve(filePath);
    const fileStat = await fsp.lstat(resolvedPath);

    let type: FileEntry['type'] = 'other';
    if (fileStat.isDirectory()) type = 'directory';
    else if (fileStat.isSymbolicLink()) type = 'symlink';
    else if (fileStat.isFile()) type = 'file';

    let owner = String(fileStat.uid);
    let group = String(fileStat.gid);
    try {
      const { stdout } = await execAsync(`stat -c '%U:%G' "${resolvedPath}" 2>/dev/null`);
      const parts = stdout.trim().split(':');
      if (parts.length === 2) { owner = parts[0]; group = parts[1]; }
    } catch { /* keep numeric */ }

    let readable = true, writable = true;
    try { await fsp.access(resolvedPath, fs.constants.R_OK); } catch { readable = false; }
    try { await fsp.access(resolvedPath, fs.constants.W_OK); } catch { writable = false; }

    return {
      name: path.basename(resolvedPath),
      path: resolvedPath,
      type,
      size: fileStat.size,
      modified: fileStat.mtime.toISOString(),
      created: fileStat.birthtime.toISOString(),
      permissions: this.formatPermissions(fileStat.mode),
      owner,
      group,
      extension: type === 'file' ? path.extname(resolvedPath).toLowerCase() : '',
      hidden: path.basename(resolvedPath).startsWith('.'),
      readable,
      writable,
    };
  }

  /**
   * Read file content (text files only, with size limit)
   */
  async readFile(filePath: string, maxSizeBytes = 5 * 1024 * 1024): Promise<{ content: string; truncated: boolean; size: number }> {
    const resolvedPath = path.resolve(filePath);
    const stat = await fsp.stat(resolvedPath);

    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size > maxSizeBytes * 2) throw new Error(`File too large (${this.formatSize(stat.size)}). Max: ${this.formatSize(maxSizeBytes * 2)}`);

    const truncated = stat.size > maxSizeBytes;
    const buffer = Buffer.alloc(Math.min(stat.size, maxSizeBytes));
    const fd = await fsp.open(resolvedPath, 'r');
    await fd.read(buffer, 0, buffer.length, 0);
    await fd.close();

    return {
      content: buffer.toString('utf-8'),
      truncated,
      size: stat.size,
    };
  }

  /**
   * Create a new directory
   */
  async createDirectory(dirPath: string): Promise<void> {
    const resolvedPath = path.resolve(dirPath);
    await fsp.mkdir(resolvedPath, { recursive: true });
    this.logger.info('FILES', `Created directory: ${resolvedPath}`);
  }

  /**
   * Create a new file
   */
  async createFile(filePath: string, content = ''): Promise<void> {
    const resolvedPath = path.resolve(filePath);
    const dir = path.dirname(resolvedPath);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(resolvedPath, content);
    this.logger.info('FILES', `Created file: ${resolvedPath}`);
  }

  /**
   * Delete file or directory
   */
  async delete(targetPath: string): Promise<void> {
    const resolvedPath = path.resolve(targetPath);

    if (this.isProtected(resolvedPath)) {
      throw new Error(`Cannot delete protected system path: ${resolvedPath}`);
    }

    const stat = await fsp.lstat(resolvedPath);
    if (stat.isDirectory()) {
      await fsp.rm(resolvedPath, { recursive: true, force: true });
    } else {
      await fsp.unlink(resolvedPath);
    }
    this.logger.info('FILES', `Deleted: ${resolvedPath}`);
  }

  /**
   * Rename/move file or directory
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const resolvedOld = path.resolve(oldPath);
    const resolvedNew = path.resolve(newPath);

    if (this.isProtected(resolvedOld)) {
      throw new Error(`Cannot move/rename protected system path: ${resolvedOld}`);
    }

    await fsp.rename(resolvedOld, resolvedNew);
    this.logger.info('FILES', `Renamed: ${resolvedOld} -> ${resolvedNew}`);
  }

  /**
   * Copy file or directory
   */
  async copy(srcPath: string, destPath: string): Promise<void> {
    const resolvedSrc = path.resolve(srcPath);
    const resolvedDest = path.resolve(destPath);

    const stat = await fsp.lstat(resolvedSrc);
    if (stat.isDirectory()) {
      await execAsync(`cp -r "${resolvedSrc}" "${resolvedDest}"`);
    } else {
      await fsp.copyFile(resolvedSrc, resolvedDest);
    }
    this.logger.info('FILES', `Copied: ${resolvedSrc} -> ${resolvedDest}`);
  }

  /**
   * Change file/directory permissions
   */
  async chmod(targetPath: string, mode: string): Promise<void> {
    const resolvedPath = path.resolve(targetPath);
    if (this.isProtected(resolvedPath)) {
      throw new Error(`Cannot change permissions on protected system path: ${resolvedPath}`);
    }
    await execAsync(`chmod ${mode} "${resolvedPath}"`);
    this.logger.info('FILES', `Changed permissions: ${resolvedPath} -> ${mode}`);
  }

  /**
   * Change file/directory ownership
   */
  async chown(targetPath: string, owner: string, group?: string): Promise<void> {
    const resolvedPath = path.resolve(targetPath);
    if (this.isProtected(resolvedPath)) {
      throw new Error(`Cannot change ownership of protected system path: ${resolvedPath}`);
    }
    const ownerGroup = group ? `${owner}:${group}` : owner;
    await execAsync(`chown ${ownerGroup} "${resolvedPath}"`);
    this.logger.info('FILES', `Changed ownership: ${resolvedPath} -> ${ownerGroup}`);
  }

  /**
   * Search for files
   */
  async search(rootPath: string, query: string, maxResults = 100): Promise<FileSearchResult[]> {
    const resolvedPath = path.resolve(rootPath);
    const results: FileSearchResult[] = [];

    try {
      const { stdout } = await execAsync(
        `find "${resolvedPath}" -maxdepth 5 -iname "*${query.replace(/['"\\]/g, '')}*" -type f -o -iname "*${query.replace(/['"\\]/g, '')}*" -type d 2>/dev/null | head -${maxResults}`,
        { timeout: 15000 }
      );

      for (const line of stdout.trim().split('\n').filter(l => l)) {
        try {
          const fileStat = await fsp.lstat(line);
          results.push({
            path: line,
            name: path.basename(line),
            type: fileStat.isDirectory() ? 'directory' : 'file',
            size: fileStat.size,
            modified: fileStat.mtime.toISOString(),
          });
        } catch { /* skip unreadable */ }
      }
    } catch (error) {
      this.logger.warn('FILES', `Search error: ${error}`);
    }

    return results;
  }

  /**
   * Search file contents (grep)
   */
  async searchContent(rootPath: string, pattern: string, maxResults = 50): Promise<FileSearchResult[]> {
    const resolvedPath = path.resolve(rootPath);
    const results: FileSearchResult[] = [];

    try {
      const safePattern = pattern.replace(/['"\\]/g, '');
      const { stdout } = await execAsync(
        `grep -rl --include="*.{txt,conf,cfg,log,json,xml,yaml,yml,ini,sh,py,js,ts,md,html,css}" -i "${safePattern}" "${resolvedPath}" 2>/dev/null | head -${maxResults}`,
        { timeout: 30000 }
      );

      for (const line of stdout.trim().split('\n').filter(l => l)) {
        try {
          const fileStat = await fsp.lstat(line);
          // Get a line of context
          const { stdout: ctx } = await execAsync(
            `grep -m 1 -i "${safePattern}" "${line}" 2>/dev/null`
          );
          results.push({
            path: line,
            name: path.basename(line),
            type: 'file',
            size: fileStat.size,
            modified: fileStat.mtime.toISOString(),
            matchContext: ctx.trim().substring(0, 200),
          });
        } catch { /* skip */ }
      }
    } catch (error) {
      this.logger.warn('FILES', `Content search error: ${error}`);
    }

    return results;
  }

  /**
   * Get directory size
   */
  async getDirectorySize(dirPath: string): Promise<number> {
    const resolvedPath = path.resolve(dirPath);
    try {
      const { stdout } = await execAsync(`du -sb "${resolvedPath}" 2>/dev/null | awk '{print $1}'`, { timeout: 30000 });
      return parseInt(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get disk usage for a path
   */
  async getDiskUsage(dirPath: string): Promise<{ total: number; used: number; free: number; percent: number }> {
    const resolvedPath = path.resolve(dirPath);
    try {
      const { stdout } = await execAsync(`df -B1 "${resolvedPath}" 2>/dev/null | tail -1`);
      const parts = stdout.trim().split(/\s+/);
      return {
        total: parseInt(parts[1]) || 0,
        used: parseInt(parts[2]) || 0,
        free: parseInt(parts[3]) || 0,
        percent: parseInt(parts[4]?.replace('%', '')) || 0,
      };
    } catch {
      return { total: 0, used: 0, free: 0, percent: 0 };
    }
  }

  // ── Helpers ──

  private formatPermissions(mode: number): string {
    const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
    const owner = perms[(mode >> 6) & 7];
    const group = perms[(mode >> 3) & 7];
    const other = perms[mode & 7];
    return `${owner}${group}${other}`;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
}
