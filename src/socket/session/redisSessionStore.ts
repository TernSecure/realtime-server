import { Redis } from 'ioredis';
import type { Session, SessionStore } from '../../types';
import { SESSION_PREFIX, CLIENT_SESSION_PREFIX } from '../../types';

// Session TTL in seconds (24 hours)
const SESSION_TTL = 24 * 60 * 60;

export class RedisSessionStore implements SessionStore {
  private redis: Redis;
  
  constructor(redis: Redis) {
    this.redis = redis;
  }

  async findSession(sessionId: string): Promise<Session | null> { //coorect method to get hset
    const sessionKey = `${SESSION_PREFIX}${sessionId}`;
    
    // Use hgetall to retrieve the hash data
    const sessionData = await this.redis.hgetall(sessionKey);
    
    // If empty object is returned, the key doesn't exist
    if (Object.keys(sessionData).length === 0) {
      return null;
    }
    
    // Get the socket IDs for this session
    const socketIds = await this.redis.smembers(`${sessionKey}:sockets`);
    
    // Convert the hash data to a Session object
    return {
      sessionId,
      clientId: sessionData.clientId,
      connected: sessionData.connected === 'true',
      lastActive: parseInt(sessionData.lastActive || '0', 10),
      userAgent: sessionData.userAgent || undefined,
      ip: sessionData.ip || undefined,
      socketIds: socketIds
    };
  }

  async findSessionByClientId(clientId: string): Promise<Session | null> {
    const sessionId = await this.redis.get(`${CLIENT_SESSION_PREFIX}${clientId}`);
    if (sessionId) {
      return this.findSession(sessionId);
    }
    return null;
  }

  async createSession(session: Session): Promise<Session> {
    await this.saveSession(session);
    return session;
  }

  async saveSession(session: Session): Promise<void> {
    const sessionKey = `${SESSION_PREFIX}${session.sessionId}`;
    const clientKey = `${CLIENT_SESSION_PREFIX}${session.clientId}`;
    const socketSetKey = `${sessionKey}:sockets`;
    
    // Use multi to execute commands atomically
    const multi = this.redis.multi();
      // Store session data as a hash
      multi.hset(
        sessionKey,
        'clientId', session.clientId,
        'connected', String(session.connected),
        'lastActive', String(session.lastActive),
        'userAgent', session.userAgent || '',
        'ip', session.ip || '',
      )
      // Set expiration on the session hash
      multi.expire(sessionKey, SESSION_TTL)
      // Map client ID to session ID
      multi.set(clientKey, session.sessionId)
      // Set the same expiration on the client mapping
      multi.expire(clientKey, SESSION_TTL)

      // store socket IDs in a separate set

      if ( session.socketIds && session.socketIds.length > 0) {
        multi.del(socketSetKey);
        multi.sadd(socketSetKey, ...session.socketIds);
        multi.expire(socketSetKey, SESSION_TTL);

      }
      await multi.exec();
  }


  async updateConnectionStatus(
    sessionId: string, 
    socketId: string, 
    connected: boolean
  ): Promise<void> {
    const session = await this.findSession(sessionId);
    if (session) {
      const socketSetKey = `${SESSION_PREFIX}${sessionId}:sockets`;
      
      if (connected) {
        await this.redis.sadd(socketSetKey, socketId);

        session.socketIds = [...session.socketIds, socketId];
        session.connected = true;
      } else {
        await this.redis.srem(socketSetKey, socketId);

        session.socketIds = session.socketIds.filter(id => id !== socketId);
        session.connected = session.socketIds.length > 0;
      }
      
      session.lastActive = Date.now();
      
      await this.saveSession(session);
    }
  }

  async removeSocket(sessionId: string, socketId: string): Promise<boolean> {
    const socketSetKey = `${SESSION_PREFIX}${sessionId}:sockets`;
    
    // Remove socket ID from the set
    await this.redis.srem(socketSetKey, socketId);
    
    // Get remaining sockets
    const remainingSockets = await this.redis.smembers(socketSetKey);
    
    // Update session data
    const session = await this.findSession(sessionId);
    if (session) {
      session.socketIds = remainingSockets;
      session.connected = remainingSockets.length > 0;
      session.lastActive = Date.now();
      
      await this.saveSession(session);
      return remainingSockets.length === 0;
    }
    
    return true;
  }
} 