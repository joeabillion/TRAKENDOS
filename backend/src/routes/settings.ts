import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { SettingsModel } from '../models/settings';

export function createSettingsRouter(settingsModel: SettingsModel): Router {
  const router = Router();

  router.get('/ssh', (req: AuthRequest, res: Response) => {
    try {
      const settings = settingsModel.getSSHSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/ssh', (req: AuthRequest, res: Response) => {
    try {
      settingsModel.setSSHSettings(req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/docker', (req: AuthRequest, res: Response) => {
    try {
      const settings = settingsModel.getDockerSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/docker', (req: AuthRequest, res: Response) => {
    try {
      settingsModel.setDockerSettings(req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/theme', (req: AuthRequest, res: Response) => {
    try {
      const settings = settingsModel.getThemeSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/theme', (req: AuthRequest, res: Response) => {
    try {
      settingsModel.setThemeSettings(req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/general', (req: AuthRequest, res: Response) => {
    try {
      const settings = settingsModel.getGeneralSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/general', (req: AuthRequest, res: Response) => {
    try {
      settingsModel.setGeneralSettings(req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/maya', (req: AuthRequest, res: Response) => {
    try {
      const settings = settingsModel.getMayaSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/maya', (req: AuthRequest, res: Response) => {
    try {
      settingsModel.setMayaSettings(req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/updates', (req: AuthRequest, res: Response) => {
    try {
      const settings = settingsModel.getUpdateSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/updates', (req: AuthRequest, res: Response) => {
    try {
      settingsModel.setUpdateSettings(req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
