import express from 'express';
import { Redis } from 'ioredis';
import { createAuthHandler, createKeysHandler } from '../../socket';
import { SessionStore } from '../../types';

export const setupAuthRoutes = (sessionStore: SessionStore) => {
  const router = express.Router();
  
  router.post('/', createAuthHandler(sessionStore));
  router.post('/keys', createKeysHandler(sessionStore));
  
  return router;
};