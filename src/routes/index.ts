import { Router } from 'express';
import { Server } from 'socket.io';
import { Redis } from 'ioredis';
import statusRoutes from './status';


export const createRoutes = (io: Server, redis: Redis, NOTIFICATION_ROOM: string) => {
  const router = Router();

  // Mount routes
  router.use('/api', statusRoutes);
  //router.use('/api/notifications', createNotificationRoutes(io, redis, NOTIFICATION_ROOM));

  return router;
};