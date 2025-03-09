import express from 'express';
import { Redis } from 'ioredis';
import { createAuthHandler, createKeysHandler } from '../../socket';

export const setupAuthRoutes = (redis: Redis) => {
  const router = express.Router();
  
  router.post('/', createAuthHandler(redis));
  router.post('/keys', createKeysHandler(redis));
  
  return router;
};