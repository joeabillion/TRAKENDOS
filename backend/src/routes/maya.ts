import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { MayaService } from '../services/mayaService';
import MAYA_KNOWLEDGE_BASE from '../maya/knowledgeBase';

export function createMayaRouter(maya: MayaService): Router {
  const router = Router();

  router.get('/status', async (req: AuthRequest, res: Response) => {
    try {
      const status = await maya.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/investigate', async (req: AuthRequest, res: Response) => {
    try {
      const { target } = req.body;
      if (!target) {
        res.status(400).json({ error: 'target required' });
        return;
      }

      const action = await maya.investigate(target);
      res.json(action);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/repair', async (req: AuthRequest, res: Response) => {
    try {
      const { target } = req.body;
      if (!target) {
        res.status(400).json({ error: 'target required' });
        return;
      }

      const action = await maya.repair(target);
      res.json(action);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/optimize', async (req: AuthRequest, res: Response) => {
    try {
      const action = await maya.optimize();
      res.json(action);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/scan', async (req: AuthRequest, res: Response) => {
    try {
      const action = await maya.scan();
      res.json(action);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/duplicates', async (req: AuthRequest, res: Response) => {
    try {
      const action = await maya.findDuplicates();
      res.json(action);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/notifications', (req: AuthRequest, res: Response) => {
    try {
      const notifications = maya.getNotifications();
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/notifications/:id/dismiss', (req: AuthRequest, res: Response) => {
    try {
      maya.dismissNotification(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/history', (req: AuthRequest, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const history = maya.getHistory(limit);
      res.json(history);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/chat', async (req: AuthRequest, res: Response) => {
    try {
      const { message, conversationId } = req.body;
      if (!message) {
        res.status(400).json({ error: 'message required' });
        return;
      }

      const response = await maya.chat(message, conversationId);
      res.json(response);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Conversation management
  router.get('/conversations', (req: AuthRequest, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const conversations = maya.listConversations(limit);
      res.json(conversations);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/conversations', (req: AuthRequest, res: Response) => {
    try {
      const { title } = req.body;
      const conversation = maya.createConversation(title);
      res.json(conversation);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/conversations/:id', (req: AuthRequest, res: Response) => {
    try {
      const conversation = maya.getConversation(req.params.id);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      res.json(conversation);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/conversations/:id', (req: AuthRequest, res: Response) => {
    try {
      maya.deleteConversation(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.put('/conversations/:id', (req: AuthRequest, res: Response) => {
    try {
      const { title } = req.body;
      if (!title) {
        res.status(400).json({ error: 'title required' });
        return;
      }
      maya.renameConversation(req.params.id, title);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Knowledge base endpoint — retrieve Maya's full instruction set
  router.get('/knowledge-base', (req: AuthRequest, res: Response) => {
    try {
      res.json(MAYA_KNOWLEDGE_BASE);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Get specific KB section
  router.get('/knowledge-base/:section', (req: AuthRequest, res: Response) => {
    try {
      const section = req.params.section as keyof typeof MAYA_KNOWLEDGE_BASE;
      if (!(section in MAYA_KNOWLEDGE_BASE)) {
        res.status(404).json({ error: `Unknown KB section: ${section}. Available: ${Object.keys(MAYA_KNOWLEDGE_BASE).join(', ')}` });
        return;
      }
      res.json(MAYA_KNOWLEDGE_BASE[section]);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
