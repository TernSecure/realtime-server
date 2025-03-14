import { Router, Request, Response } from 'express';

const router = Router();

router.get('/status', (req: Request, res: Response) => {
  res.json({ status: 'Server is running' });
});

export default router;