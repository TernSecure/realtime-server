import { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Redis } from 'ioredis';
import { getServerPublicKey } from '../../middleware';
import { SessionStore } from '../../types';


export const createAuthHandler = (sessionStore: SessionStore): RequestHandler => async (req, res) => {
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
    
    await sessionStore.createSession({
      sessionId,
      clientId,
      apiKey,
      serverPublicKey,
      clientPublicKey: '',
      encryptionReady: false, 
      createdAt: Date.now(),
      connected: false,
      lastActive: Date.now(),
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      socketIds: [] 
    });
    
    
    res.status(200).json({
      sessionId,
      serverPublicKey
    });
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const createKeysHandler = (sessionStore: SessionStore): RequestHandler => async (req, res) => {
  try {
    const { sessionId, clientPublicKey } = req.body;
    
    if (!sessionId || !clientPublicKey) {
      res.status(400).json({ 
        error: 'Missing sessionId or clientPublicKey' 
      });
      return;
    }
    
    const session = await sessionStore.findSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    
    session.clientPublicKey = clientPublicKey;
    session.encryptionReady = true;

    await sessionStore.updateConnection(session);
    
    res.status(200).json({ 
      status: 'success',
      message: 'Key exchange completed successfully'
    });
  } catch (error) {
    console.error('Key exchange error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};