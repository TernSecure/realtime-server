import express, { Request, Response, RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Redis } from 'ioredis';
import { getServerPublicKey } from '../middleware';

const router = express.Router();

// Session store configuration
const SESSION_PREFIX = 'tobedeleted:session:';
const SESSION_EXPIRY = 86400; // 24 hours

export const setupAuthRoutes = (redis: Redis) => {
  // Authentication and key exchange endpoint
  const authHandler: RequestHandler = async (req, res) => {
    try {
      const { clientId, apiKey } = req.body;
      
      if (!clientId || !apiKey) {
        res.status(401).json({ 
          error: 'Authentication failed: Missing clientId or apiKey' 
        });
        return;
      }
      
      // Validate API key (implement your validation logic)
      // ...
      
      // Generate a new session ID
      const sessionId = uuidv4();
      
      // Get server's public key
      const serverPublicKey = getServerPublicKey();
      
      // Store session data in Redis
      await redis.hset(`${SESSION_PREFIX}${sessionId}`, {
        clientId,
        apiKey,
        serverPublicKey,
        created: Date.now(),
        connected: false,
        lastActive: Date.now(),
        userAgent: req.headers['user-agent'],
        ip: req.ip
      });
      
      // Set expiry on session
      await redis.expire(`${SESSION_PREFIX}${sessionId}`, SESSION_EXPIRY);
      
      // Return session ID and server's public key to client
      res.status(200).json({
        sessionId,
        serverPublicKey
      });
    } catch (error) {
      console.error('Authentication error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  router.post('/auth', authHandler);
  
  // Client public key submission endpoint
  const keysHandler: RequestHandler = async (req, res) => {
    try {
      const { sessionId, clientPublicKey } = req.body;
      
      if (!sessionId || !clientPublicKey) {
        res.status(400).json({ 
          error: 'Missing sessionId or clientPublicKey' 
        });
        return;
      }
      
      // Verify session exists
      const sessionExists = await redis.exists(`${SESSION_PREFIX}${sessionId}`);
      if (!sessionExists) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      
      // Store client's public key with the session
      await redis.hset(`${SESSION_PREFIX}${sessionId}`, 'clientPublicKey', clientPublicKey);
      
      // Mark session as ready for encryption
      await redis.hset(`${SESSION_PREFIX}${sessionId}`, 'encryptionReady', 'true');
      
      res.status(200).json({ 
        status: 'success',
        message: 'Key exchange completed successfully'
      });
    } catch (error) {
      console.error('Key exchange error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  router.post('/keys', keysHandler);
  
  return router;
};