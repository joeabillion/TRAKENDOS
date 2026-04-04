import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { FileService } from '../services/fileService';

export function createFilesRouter(fileService: FileService): Router {
  const router = Router();

  // GET /api/files/mounts — list all mounted drives
  router.get('/mounts', async (req: AuthRequest, res: Response) => {
    try {
      const mounts = await fileService.getMounts();
      res.json(mounts);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/files/list?path=/some/path&hidden=true — list directory
  router.get('/list', async (req: AuthRequest, res: Response) => {
    try {
      const dirPath = (req.query.path as string) || '/';
      const showHidden = req.query.hidden === 'true';
      const listing = await fileService.listDirectory(dirPath, showHidden);
      // Add protection status to each entry
      const enriched = {
        ...listing,
        entries: listing.entries.map((entry: any) => ({
          ...entry,
          protected: fileService.isProtected(entry.path),
        })),
      };
      res.json(enriched);
    } catch (error: any) {
      const status = error.code === 'ENOENT' ? 404 : error.code === 'EACCES' ? 403 : 500;
      res.status(status).json({ error: error.message || String(error) });
    }
  });

  // GET /api/files/info?path=/some/file — get file info
  router.get('/info', async (req: AuthRequest, res: Response) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path is required' });
      const info = await fileService.getFileInfo(filePath);
      res.json(info);
    } catch (error: any) {
      const status = error.code === 'ENOENT' ? 404 : 500;
      res.status(status).json({ error: error.message || String(error) });
    }
  });

  // GET /api/files/read?path=/some/file — read file content
  router.get('/read', async (req: AuthRequest, res: Response) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path is required' });
      const result = await fileService.readFile(filePath);
      res.json(result);
    } catch (error: any) {
      const status = error.code === 'ENOENT' ? 404 : 500;
      res.status(status).json({ error: error.message || String(error) });
    }
  });

  // GET /api/files/download?path=/some/file — download file
  router.get('/download', async (req: AuthRequest, res: Response) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) return res.status(400).json({ error: 'path is required' });
      const info = await fileService.getFileInfo(filePath);
      if (info.type !== 'file') return res.status(400).json({ error: 'Not a file' });
      res.download(filePath);
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // POST /api/files/mkdir — create directory
  router.post('/mkdir', async (req: AuthRequest, res: Response) => {
    try {
      const { path: dirPath } = req.body;
      if (!dirPath) return res.status(400).json({ error: 'path is required' });
      await fileService.createDirectory(dirPath);
      res.json({ success: true, path: dirPath });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // POST /api/files/create — create file
  router.post('/create', async (req: AuthRequest, res: Response) => {
    try {
      const { path: filePath, content } = req.body;
      if (!filePath) return res.status(400).json({ error: 'path is required' });
      await fileService.createFile(filePath, content || '');
      res.json({ success: true, path: filePath });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // POST /api/files/delete — delete file or directory
  router.post('/delete', async (req: AuthRequest, res: Response) => {
    try {
      const { path: targetPath } = req.body;
      if (!targetPath) return res.status(400).json({ error: 'path is required' });
      await fileService.delete(targetPath);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // POST /api/files/rename — rename/move
  router.post('/rename', async (req: AuthRequest, res: Response) => {
    try {
      const { oldPath, newPath } = req.body;
      if (!oldPath || !newPath) return res.status(400).json({ error: 'oldPath and newPath are required' });
      await fileService.rename(oldPath, newPath);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // POST /api/files/copy — copy file or directory
  router.post('/copy', async (req: AuthRequest, res: Response) => {
    try {
      const { src, dest } = req.body;
      if (!src || !dest) return res.status(400).json({ error: 'src and dest are required' });
      await fileService.copy(src, dest);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // POST /api/files/chmod — change permissions
  router.post('/chmod', async (req: AuthRequest, res: Response) => {
    try {
      const { path: targetPath, mode } = req.body;
      if (!targetPath || !mode) return res.status(400).json({ error: 'path and mode are required' });
      await fileService.chmod(targetPath, mode);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // POST /api/files/chown — change ownership
  router.post('/chown', async (req: AuthRequest, res: Response) => {
    try {
      const { path: targetPath, owner, group } = req.body;
      if (!targetPath || !owner) return res.status(400).json({ error: 'path and owner are required' });
      await fileService.chown(targetPath, owner, group);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // GET /api/files/search?path=/&query=filename — search files
  router.get('/search', async (req: AuthRequest, res: Response) => {
    try {
      const rootPath = (req.query.path as string) || '/';
      const query = req.query.query as string;
      if (!query) return res.status(400).json({ error: 'query is required' });
      const results = await fileService.search(rootPath, query);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // GET /api/files/search-content?path=/&pattern=text — search file contents
  router.get('/search-content', async (req: AuthRequest, res: Response) => {
    try {
      const rootPath = (req.query.path as string) || '/';
      const pattern = req.query.pattern as string;
      if (!pattern) return res.status(400).json({ error: 'pattern is required' });
      const results = await fileService.searchContent(rootPath, pattern);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  // GET /api/files/disk-usage?path=/ — get disk usage for path
  router.get('/disk-usage', async (req: AuthRequest, res: Response) => {
    try {
      const dirPath = (req.query.path as string) || '/';
      const usage = await fileService.getDiskUsage(dirPath);
      res.json(usage);
    } catch (error: any) {
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  return router;
}
