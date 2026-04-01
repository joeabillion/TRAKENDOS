import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { DockerService } from '../services/dockerService';
import { AppTemplatesService } from '../services/appTemplates';
import { EventLogger } from '../services/eventLogger';

export function createAppsRouter(dockerService: DockerService, appTemplates: AppTemplatesService, logger: EventLogger): Router {
  const router = Router();

  // Get all templates or filtered by category
  router.get('/templates', async (req: AuthRequest, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      const templates = appTemplates.getTemplates(category);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Get specific template
  router.get('/templates/:id', async (req: AuthRequest, res: Response) => {
    try {
      const template = appTemplates.getTemplateById(req.params.id);
      if (!template) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }
      res.json(template);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Get available categories
  router.get('/categories', async (req: AuthRequest, res: Response) => {
    try {
      const categories = appTemplates.getCategories();
      res.json(categories);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Deploy app from template
  router.post('/deploy', async (req: AuthRequest, res: Response) => {
    try {
      const { templateId, containerName, customSettings } = req.body;

      if (!templateId || !containerName) {
        res.status(400).json({ error: 'Template ID and container name required' });
        return;
      }

      const template = appTemplates.getTemplateById(templateId);
      if (!template) {
        res.status(404).json({ error: 'Template not found' });
        return;
      }

      // Pull image
      try {
        await dockerService.pullImage(`${template.dockerImage}:${template.dockerTag}`);
      } catch {
        logger.warn('DOCKER', `Failed to pull image or already exists: ${template.dockerImage}`);
      }

      // Prepare environment variables
      const env: string[] = [];
      for (const envVar of template.environment) {
        const value = customSettings?.env?.[envVar.name] || envVar.default;
        env.push(`${envVar.name}=${value}`);
      }

      // Prepare port bindings
      const portBindings: Record<string, any> = {};
      for (const portMap of template.ports) {
        const key = `${portMap.containerPort}/${portMap.protocol || 'tcp'}`;
        portBindings[key] = [{ HostPort: String(customSettings?.ports?.[portMap.containerPort] || portMap.hostPort) }];
      }

      // Prepare exposed ports
      const exposedPorts: Record<string, object> = {};
      for (const portMap of template.ports) {
        const key = `${portMap.containerPort}/${portMap.protocol || 'tcp'}`;
        exposedPorts[key] = {};
      }

      // Prepare volumes
      const volumeBindings: Record<string, string> = {};
      for (const volumeMount of template.volumes) {
        volumeBindings[volumeMount.containerPath] = volumeMount.hostPath;
      }

      // Create container
      const createOptions: any = {
        Image: `${template.dockerImage}:${template.dockerTag}`,
        name: containerName,
        Env: env,
        HostConfig: {
          PortBindings: portBindings,
          Binds: Object.entries(volumeBindings).map(([container, host]) => `${host}:${container}`),
          RestartPolicy: {
            Name: 'unless-stopped',
            MaximumRetryCount: 0,
          },
        },
        ExposedPorts: exposedPorts,
      };

      // Add privileged mode if needed
      if (template.privileged) {
        createOptions.HostConfig.Privileged = true;
      }

      // Add capabilities if needed
      if (template.capabilities && template.capabilities.length > 0) {
        createOptions.HostConfig.CapAdd = template.capabilities;
      }

      // Add resource limits
      if (template.resourceLimits) {
        if (template.resourceLimits.memoryLimits) {
          // Parse memory limit (e.g., "2GB" -> bytes)
          const memBytes = parseMemoryString(template.resourceLimits.memoryLimits);
          createOptions.HostConfig.Memory = memBytes;
        }

        if (template.resourceLimits.memoryReservation) {
          const memBytes = parseMemoryString(template.resourceLimits.memoryReservation);
          createOptions.HostConfig.MemoryReservation = memBytes;
        }

        if (template.resourceLimits.cpuLimits) {
          createOptions.HostConfig.CpuQuota = parseInt(template.resourceLimits.cpuLimits) * 100000;
        }

        if (template.resourceLimits.cpuReservation) {
          createOptions.HostConfig.CpuShares = parseInt(template.resourceLimits.cpuReservation) * 1024;
        }
      }

      // Use dockerode directly for container creation
      const Docker = require('dockerode');
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const container = await docker.createContainer(createOptions);
      await container.start();

      logger.info('DOCKER', `Container '${containerName}' deployed from template '${templateId}'`);

      res.json({
        success: true,
        containerName,
        containerImage: `${template.dockerImage}:${template.dockerTag}`,
        ports: template.ports,
      });
    } catch (error) {
      logger.error('DOCKER', `Failed to deploy app: ${error}`);
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}

function parseMemoryString(memStr: string): number {
  const unit = memStr.replace(/[0-9.]/g, '').toUpperCase();
  const value = parseFloat(memStr);

  switch (unit) {
    case 'B':
      return Math.round(value);
    case 'KB':
      return Math.round(value * 1024);
    case 'MB':
      return Math.round(value * 1024 * 1024);
    case 'GB':
      return Math.round(value * 1024 * 1024 * 1024);
    default:
      return Math.round(value * 1024 * 1024); // Default to MB
  }
}
