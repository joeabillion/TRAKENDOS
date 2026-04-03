import { Router, Response } from 'express';
import Docker from 'dockerode';
import * as jsYaml from 'js-yaml';
import { AuthRequest } from '../middleware/auth';
import { DockerService } from '../services/dockerService';

export function createDockerRouter(dockerService: DockerService): Router {
  const router = Router();

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

  router.post('/containers/:id/start', async (req: AuthRequest, res: Response) => {
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

  router.post('/containers/:id/restart', async (req: AuthRequest, res: Response) => {
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
      res.status(500).json({ error: String(error) });
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

  router.post('/images/pull', async (req: AuthRequest, res: Response) => {
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

  router.post('/containers/create', async (req: AuthRequest, res: Response) => {
    try {
      const { name, image, ports, env, volumes, restartPolicy, resourceLimits, privileged } = req.body;

      if (!name || !image) {
        res.status(400).json({ error: 'Container name and image are required' });
        return;
      }

      // Pull image first
      try {
        await dockerService.pullImage(image);
      } catch {
        // Image might already exist
      }

      // Prepare port bindings
      const portBindings: Record<string, any> = {};
      const exposedPorts: Record<string, object> = {};

      if (ports && Array.isArray(ports)) {
        for (const port of ports) {
          const key = `${port.containerPort}/${port.protocol || 'tcp'}`;
          portBindings[key] = [{ HostPort: String(port.hostPort || port.containerPort) }];
          exposedPorts[key] = {};
        }
      }

      // Prepare environment variables
      const envArray: string[] = [];
      if (env && typeof env === 'object') {
        for (const [key, value] of Object.entries(env)) {
          envArray.push(`${key}=${value}`);
        }
      }

      // Prepare volume bindings
      const binds: string[] = [];
      if (volumes && Array.isArray(volumes)) {
        for (const vol of volumes) {
          binds.push(`${vol.hostPath}:${vol.containerPath}${vol.readOnly ? ':ro' : ''}`);
        }
      }

      // Prepare container options
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });

      const createOptions: any = {
        Image: image,
        name,
        Env: envArray,
        HostConfig: {
          PortBindings: portBindings,
          Binds: binds,
          RestartPolicy: restartPolicy || { Name: 'no', MaximumRetryCount: 0 },
        },
        ExposedPorts: exposedPorts,
      };

      // Add privileged mode if needed
      if (privileged) {
        createOptions.HostConfig.Privileged = true;
      }

      // Add resource limits
      if (resourceLimits) {
        if (resourceLimits.memoryLimit) {
          createOptions.HostConfig.Memory = parseMemoryValue(resourceLimits.memoryLimit);
        }
        if (resourceLimits.memoryReservation) {
          createOptions.HostConfig.MemoryReservation = parseMemoryValue(resourceLimits.memoryReservation);
        }
        if (resourceLimits.cpuLimit) {
          createOptions.HostConfig.CpuQuota = Math.round(parseFloat(resourceLimits.cpuLimit) * 100000);
        }
        if (resourceLimits.cpuShares) {
          createOptions.HostConfig.CpuShares = Math.round(parseFloat(resourceLimits.cpuShares) * 1024);
        }
      }

      const container = await docker.createContainer(createOptions);
      await container.start();

      res.json({
        success: true,
        containerId: container.id.substring(0, 12),
        containerName: name,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
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

  router.post('/compose/up', async (req: AuthRequest, res: Response) => {
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
