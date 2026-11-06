import { Router, Response, NextFunction } from 'express';
import Docker from 'dockerode';
import * as jsYaml from 'js-yaml';
import { AuthRequest } from '../middleware/auth';
import { DockerService, DockerServiceError } from '../services/dockerService';
import { WebSocket } from 'ws';

/** Minimal view of ArrayService needed for gating container mutations. */
export interface ArrayStateProvider {
  getArrayConfig(): { state: string };
}

/**
 * Express middleware factory: when an array service is supplied and the array is not
 * running, mutating container operations are refused with 409 ARRAY_NOT_RUNNING.
 * Without an array service the check is skipped (backward compatible).
 */
export function requireArrayRunning(arrayService?: ArrayStateProvider) {
  return (_req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!arrayService) {
      next();
      return;
    }
    let state = 'unknown';
    try {
      state = arrayService.getArrayConfig()?.state ?? 'unknown';
    } catch {
      state = 'unknown';
    }
    if (state !== 'running') {
      res.status(409).json({
        error: 'ARRAY_NOT_RUNNING',
        message: 'Start the array before managing containers',
        state,
      });
      return;
    }
    next();
  };
}

/** Send an error with the status carried by DockerServiceError (default 500). */
function sendError(res: Response, error: unknown): void {
  if (res.headersSent) {
    try {
      res.write(`data: ${JSON.stringify({ error: String(error) })}\n\n`);
      res.end();
    } catch {
      /* ignore */
    }
    return;
  }
  const status = error instanceof DockerServiceError ? error.status : 500;
  const statusCode = (error as any)?.statusCode;
  res.status(status === 500 && typeof statusCode === 'number' ? statusCode : status).json({ error: String((error as any)?.message ?? error) });
}

/**
 * Normalize the many shapes the frontend sends for container creation into a
 * dockerode createContainer options object.
 *
 * Accepts both:
 *  - env: { KEY: 'value' }               or environment: [{ name, value }]  or env: ['KEY=value']
 *  - restartPolicy: 'unless-stopped'      or restartPolicy: { Name, MaximumRetryCount }
 *  - cpuCores / memoryMb                  or resourceLimits: { cpuLimit, memoryLimit, ... }
 *  - network: 'bridge'                    (-> HostConfig.NetworkMode)
 *  - volumes: [{ hostPath, containerPath, readOnly? }]  (-> Binds)
 *  - gpu: 'nvidia' | 'none'               (-> DeviceRequests + NVIDIA_* env)
 */
export function buildCreateOptions(body: any): Docker.ContainerCreateOptions {
  const {
    name,
    image,
    ports,
    env,
    environment,
    volumes,
    restartPolicy,
    resourceLimits,
    privileged,
    cpuCores,
    memoryMb,
    network,
    gpu,
    capabilities,
    devices,
    labels,
  } = body || {};

  // Ports
  const portBindings: Record<string, any> = {};
  const exposedPorts: Record<string, object> = {};
  if (Array.isArray(ports)) {
    for (const port of ports) {
      if (!port || !port.containerPort) continue;
      const protocol = (port.protocol || 'tcp').toLowerCase();
      const key = `${port.containerPort}/${protocol}`;
      const hostPort = port.hostPort || port.containerPort;
      portBindings[key] = [{ HostPort: String(hostPort) }];
      exposedPorts[key] = {};
    }
  }

  // Environment
  const envMap = new Map<string, string>();
  const addEnv = (k: unknown, v: unknown) => {
    if (typeof k !== 'string' || !k.trim()) return;
    envMap.set(k.trim(), v === undefined || v === null ? '' : String(v));
  };
  if (Array.isArray(env)) {
    for (const item of env) {
      if (typeof item === 'string') {
        const idx = item.indexOf('=');
        if (idx > 0) addEnv(item.slice(0, idx), item.slice(idx + 1));
      } else if (item && typeof item === 'object') {
        addEnv(item.name ?? item.key, item.value);
      }
    }
  } else if (env && typeof env === 'object') {
    for (const [k, v] of Object.entries(env)) addEnv(k, v);
  }
  if (Array.isArray(environment)) {
    for (const item of environment) {
      if (item && typeof item === 'object') addEnv(item.name ?? item.key, item.value);
    }
  }

  // Volumes -> Binds
  const binds: string[] = [];
  if (Array.isArray(volumes)) {
    for (const vol of volumes) {
      if (typeof vol === 'string') {
        if (vol.includes(':')) binds.push(vol);
        continue;
      }
      if (!vol || !vol.hostPath || !vol.containerPath) continue;
      binds.push(`${vol.hostPath}:${vol.containerPath}${vol.readOnly ? ':ro' : ''}`);
    }
  }

  // Restart policy
  let restart: { Name: string; MaximumRetryCount: number } = { Name: 'no', MaximumRetryCount: 0 };
  if (typeof restartPolicy === 'string' && restartPolicy) {
    restart = { Name: restartPolicy, MaximumRetryCount: restartPolicy === 'on-failure' ? 5 : 0 };
  } else if (restartPolicy && typeof restartPolicy === 'object' && restartPolicy.Name) {
    restart = { Name: restartPolicy.Name, MaximumRetryCount: restartPolicy.MaximumRetryCount || 0 };
  } else if (restartPolicy && typeof restartPolicy === 'object' && restartPolicy.name) {
    restart = { Name: restartPolicy.name, MaximumRetryCount: restartPolicy.maxRetryCount || 0 };
  }

  const hostConfig: any = {
    PortBindings: portBindings,
    Binds: binds,
    RestartPolicy: restart,
  };

  if (privileged) hostConfig.Privileged = true;
  if (typeof network === 'string' && network.trim()) hostConfig.NetworkMode = network.trim();
  if (Array.isArray(capabilities) && capabilities.length) hostConfig.CapAdd = capabilities;
  if (Array.isArray(devices) && devices.length) hostConfig.Devices = devices;

  // Resources (flat shape)
  if (cpuCores !== undefined && cpuCores !== null && Number(cpuCores) > 0) {
    hostConfig.NanoCpus = Math.round(Number(cpuCores) * 1e9);
  }
  if (memoryMb !== undefined && memoryMb !== null && Number(memoryMb) > 0) {
    hostConfig.Memory = Math.round(Number(memoryMb) * 1024 * 1024);
  }

  // Resources (legacy nested shape)
  if (resourceLimits && typeof resourceLimits === 'object') {
    if (resourceLimits.memoryLimit) hostConfig.Memory = parseMemoryValue(resourceLimits.memoryLimit);
    if (resourceLimits.memoryReservation) hostConfig.MemoryReservation = parseMemoryValue(resourceLimits.memoryReservation);
    if (resourceLimits.cpuLimit) hostConfig.NanoCpus = Math.round(parseFloat(resourceLimits.cpuLimit) * 1e9);
    if (resourceLimits.cpuShares) hostConfig.CpuShares = Math.round(parseFloat(resourceLimits.cpuShares) * 1024);
  }

  // GPU passthrough
  if (gpu === 'nvidia' || gpu === true) {
    hostConfig.DeviceRequests = [{ Driver: 'nvidia', Count: -1, Capabilities: [['gpu']] }];
    if (!envMap.has('NVIDIA_VISIBLE_DEVICES')) envMap.set('NVIDIA_VISIBLE_DEVICES', 'all');
    if (!envMap.has('NVIDIA_DRIVER_CAPABILITIES')) envMap.set('NVIDIA_DRIVER_CAPABILITIES', 'all');
  }

  const options: Docker.ContainerCreateOptions = {
    Image: image,
    name,
    Env: Array.from(envMap.entries()).map(([k, v]) => `${k}=${v}`),
    ExposedPorts: exposedPorts,
    HostConfig: hostConfig,
  };
  if (labels && typeof labels === 'object') options.Labels = labels;

  return options;
}

/**
 * NOTE for index.ts wiring: pass the ArrayService as the 2nd argument so container
 * mutations are refused while the array is stopped:
 *
 *   createDockerRouter(dockerService, arrayService)
 *
 * Omitting it keeps the previous behaviour (no gating).
 */
export function createDockerRouter(dockerService: DockerService, arrayService?: ArrayStateProvider): Router {
  const router = Router();
  const gate = requireArrayRunning(arrayService);

  router.get('/containers', async (req: AuthRequest, res: Response) => {
    try {
      const all = req.query.all === 'true';
      const containers = await dockerService.listContainers(all);
      res.json(containers);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/containers/:id/stats', async (req: AuthRequest, res: Response) => {
    try {
      const stats = await dockerService.getContainerStats(req.params.id);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/containers/:id/logs', async (req: AuthRequest, res: Response) => {
    try {
      const lines = req.query.lines ? parseInt(req.query.lines as string, 10) : 100;
      const timestamps = req.query.timestamps !== 'false';
      const logs = await dockerService.getContainerLogs(req.params.id, lines, timestamps);
      res.json({ logs });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/containers/:id/start', gate, async (req: AuthRequest, res: Response) => {
    try {
      await dockerService.startContainer(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/containers/:id/stop', async (req: AuthRequest, res: Response) => {
    try {
      const timeout = req.body.timeout || 10;
      await dockerService.stopContainer(req.params.id, timeout);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/containers/:id/restart', gate, async (req: AuthRequest, res: Response) => {
    try {
      const timeout = req.body.timeout || 10;
      await dockerService.restartContainer(req.params.id, timeout);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/containers/:id/remove', async (req: AuthRequest, res: Response) => {
    try {
      const force = req.body.force || false;
      await dockerService.removeContainer(req.params.id, force);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put('/containers/:id/settings', async (req: AuthRequest, res: Response) => {
    try {
      await dockerService.updateContainerSettings(req.params.id, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/images', async (req: AuthRequest, res: Response) => {
    try {
      const images = await dockerService.listImages();
      res.json(images);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/images/pull', gate, async (req: AuthRequest, res: Response) => {
    try {
      const { imageRef } = req.body;
      if (!imageRef) {
        res.status(400).json({ error: 'imageRef required' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      await dockerService.pullImage(imageRef, (progress) => {
        res.write(`data: ${JSON.stringify(progress)}\n\n`);
      });

      res.end();
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/images/:id', async (req: AuthRequest, res: Response) => {
    try {
      const force = req.query.force === 'true';
      await dockerService.removeImage(req.params.id, force);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/networks', async (req: AuthRequest, res: Response) => {
    try {
      const networks = await dockerService.listNetworks();
      res.json(networks);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/volumes', async (req: AuthRequest, res: Response) => {
    try {
      const volumes = await dockerService.listVolumes();
      res.json(volumes);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/containers/create', gate, async (req: AuthRequest, res: Response) => {
    try {
      const { name, image } = req.body || {};

      if (!name || !image) {
        res.status(400).json({ error: 'Container name and image are required' });
        return;
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(String(name))) {
        res.status(400).json({ error: 'Invalid container name' });
        return;
      }

      // Pull image first (ignore failures; the image may already exist locally)
      try {
        await dockerService.pullImage(image);
      } catch {
        // Image might already exist
      }

      const createOptions = buildCreateOptions(req.body);

      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const container = await docker.createContainer(createOptions);
      await container.start();

      res.json({
        success: true,
        id: container.id,
        containerId: container.id.substring(0, 12),
        containerName: name,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/containers/:id/inspect', async (req: AuthRequest, res: Response) => {
    try {
      const inspectData = await dockerService.inspectContainer(req.params.id);
      res.json(inspectData);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/containers/:id/update', async (req: AuthRequest, res: Response) => {
    try {
      await dockerService.updateContainerSettings(req.params.id, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/containers/:id/recreate', gate, async (req: AuthRequest, res: Response) => {
    try {
      const config = req.body?.config ?? req.body ?? {};
      const newContainerId = await dockerService.recreateContainer(req.params.id, config);
      res.json({ success: true, containerId: newContainerId });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/compose/validate', async (req: AuthRequest, res: Response) => {
    try {
      const { yaml } = req.body;
      if (!yaml) {
        res.status(400).json({ error: 'YAML content required' });
        return;
      }

      // Basic YAML validation - check if it's valid YAML
      try {
        jsYaml.load(yaml);
        res.json({ valid: true });
      } catch (parseError) {
        res.json({ valid: false, error: String(parseError) });
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/compose/up', gate, async (req: AuthRequest, res: Response) => {
    try {
      const { yaml } = req.body;
      if (!yaml) {
        res.status(400).json({ error: 'docker-compose YAML required' });
        return;
      }

      // This is a simplified implementation
      // For full docker-compose support, consider using docker-compose CLI via shell exec
      res.status(501).json({
        error: 'docker-compose deployment requires CLI. Use container creation endpoints instead.',
        note: 'Use POST /api/docker/containers/create for individual containers',
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Settings endpoints
  router.get('/settings', async (req: AuthRequest, res: Response) => {
    try {
      const settings = await dockerService.getSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/settings', async (req: AuthRequest, res: Response) => {
    try {
      const settings = req.body;
      await dockerService.updateSettings(settings);
      res.json({ success: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Storage migration
  router.post('/storage/migrate', async (req: AuthRequest, res: Response) => {
    try {
      const newPath = req.body.newPath || req.query.newPath;
      if (!newPath) {
        res.status(400).json({ error: 'newPath required' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      await dockerService.migrateStorage(newPath as string, (message) => {
        res.write(`data: ${JSON.stringify({ message })}\n\n`);
      });

      res.end();
    } catch (error) {
      sendError(res, error);
    }
  });

  // Backup endpoints
  router.post('/backup', async (req: AuthRequest, res: Response) => {
    try {
      const destPath = (req.body.destPath || req.query.destPath || '/data/backups/docker/') as string;

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const backupPath = await dockerService.fullBackup(destPath, (message) => {
        res.write(`data: ${JSON.stringify({ message })}\n\n`);
      });

      res.write(`data: ${JSON.stringify({ complete: true, backupPath })}\n\n`);
      res.end();
    } catch (error) {
      sendError(res, error);
    }
  });

  // Restore endpoint
  router.post('/restore', async (req: AuthRequest, res: Response) => {
    try {
      const backupPath = (req.body.backupPath || req.query.backupPath) as string;
      if (!backupPath) {
        res.status(400).json({ error: 'backupPath required' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      await dockerService.fullRestore(backupPath, (message) => {
        res.write(`data: ${JSON.stringify({ message })}\n\n`);
      });

      res.write(`data: ${JSON.stringify({ complete: true })}\n\n`);
      res.end();
    } catch (error) {
      sendError(res, error);
    }
  });

  // Force remove container
  router.post('/containers/:id/force-remove', async (req: AuthRequest, res: Response) => {
    try {
      await dockerService.forceRemoveContainer(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Nuke a ghost container: stop daemon, delete its state dir, restart daemon
  router.post('/containers/:id/nuke', async (req: AuthRequest, res: Response) => {
    try {
      const result = await dockerService.nukeContainer(req.params.id);
      res.json({ success: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  // Delete volume
  router.delete('/volumes/:name', async (req: AuthRequest, res: Response) => {
    try {
      await dockerService.removeVolume(req.params.name);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // System prune
  router.post('/system/prune', async (req: AuthRequest, res: Response) => {
    try {
      const result = await dockerService.pruneSystem();
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Create exec session for container shell
  router.post('/containers/:id/exec', async (req: AuthRequest, res: Response) => {
    try {
      const containerId = req.params.id;
      const execId = await dockerService.createExecSession(containerId);
      res.json({ execId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}

function parseMemoryValue(value: string): number {
  if (typeof value === 'string') {
    const match = value.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
    if (match) {
      const num = parseFloat(match[1]);
      const unit = (match[2] || 'b').toLowerCase();

      switch (unit) {
        case 'kb':
          return Math.round(num * 1024);
        case 'mb':
          return Math.round(num * 1024 * 1024);
        case 'gb':
          return Math.round(num * 1024 * 1024 * 1024);
        default:
          return Math.round(num);
      }
    }
  }
  return 0;
}

export function setupDockerExecWebSocket(ws: WebSocket, execId: string, dockerService: DockerService): void {
  try {
    const execSession = dockerService.getExecSession(execId);
    if (!execSession) {
      ws.close(1008, 'Exec session not found');
      return;
    }

    const exec = execSession.exec;

    // Start the exec instance with hijacked stream
    exec.start({ hijack: true, stdin: true, Tty: true }, (err: any, stream: any) => {
      if (err) {
        ws.close(1011, `Failed to start exec: ${err.message}`);
        return;
      }

      // Pipe stream data to WebSocket
      stream.on('data', (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'terminal:data',
              data: data.toString('utf-8'),
            })
          );
        }
      });

      stream.on('error', (err: Error) => {
        ws.close(1011, `Stream error: ${err.message}`);
      });

      stream.on('end', () => {
        ws.close(1000);
      });

      // Handle WebSocket messages (input from terminal)
      ws.on('message', (message: string) => {
        try {
          const parsed = JSON.parse(message);

          if (parsed.type === 'terminal:input') {
            stream.write(parsed.data);
          } else if (parsed.type === 'terminal:resize') {
            // Resize not directly supported for exec streams
            // Could implement via SIGWINCH but requires raw mode
          }
        } catch {
          // Invalid message, ignore
        }
      });

      ws.on('close', () => {
        stream.destroy();
        dockerService.closeExecSession(execId);
      });

      ws.on('error', () => {
        stream.destroy();
        dockerService.closeExecSession(execId);
      });
    });
  } catch (error) {
    ws.close(1011, String(error));
  }
}
