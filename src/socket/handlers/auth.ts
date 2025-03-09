import { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Redis } from 'ioredis';
import { getServerPublicKey } from '../../middleware';

const SESSION_PREFIX = 'tobedeleted:session:';
const SESSION_EXPIRY = 86400; // 24 hours

export const createAuthHandler = (redis: Redis): RequestHandler => async (req, res) => {
  try {
    const { clientId, apiKey } = req.body;
    
    if (!clientId || !apiKey) {
      res.status(401).json({ 
        error: 'Authentication failed: Missing clientId or apiKey' 
      });
      return;
    }
    
    const sessionId = uuidv4();
    const serverPublicKey = getServerPublicKey();
    
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
    
    await redis.expire(`${SESSION_PREFIX}${sessionId}`, SESSION_EXPIRY);
    
    res.status(200).json({
      sessionId,
      serverPublicKey
    });
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createKeysHandler = (redis: Redis): RequestHandler => async (req, res) => {
  try {
    const { sessionId, clientPublicKey } = req.body;
    
    if (!sessionId || !clientPublicKey) {
      res.status(400).json({ 
        error: 'Missing sessionId or clientPublicKey' 
      });
      return;
    }
    
    const sessionExists = await redis.exists(`${SESSION_PREFIX}${sessionId}`);
    if (!sessionExists) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    
    await redis.hset(`${SESSION_PREFIX}${sessionId}`, 'clientPublicKey', clientPublicKey);
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