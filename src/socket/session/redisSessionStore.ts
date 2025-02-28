import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import type { Session, SessionStore } from '../../types';
import { SESSION_PREFIX, CLIENT_SESSION_PREFIX } from '../../types';

// Session TTL in seconds (24 hours)
const SESSION_TTL = 24 * 60 * 60;

export class RedisSessionStore implements SessionStore {
  private redis: Redis;
  
  constructor(redis: Redis) {
    this.redis = redis;
  }

  async findSession(sessionId: string): Promise<Session | null> {
    const sessionData = await this.redis.get(`${SESSION_PREFIX}${sessionId}`);
    if (sessionData) {
      return JSON.parse(sessionData) as Session;
    }
    return null;
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
    
    // Use multi to execute commands atomically
    await this.redis
      .multi()
      // Store session data as a hash
      .hset(
        sessionKey,
        'clientId', session.clientId,
        'connected', String(session.connected),
        'lastActive', String(session.lastActive),
        'userAgent', session.userAgent || '',
        'ip', session.ip || '',
      )
      // Set expiration on the session hash
      .expire(sessionKey, SESSION_TTL)
      // Map client ID to session ID
      .set(clientKey, session.sessionId)
      // Set the same expiration on the client mapping
      .expire(clientKey, SESSION_TTL)
      .exec();
  }


  async updateConnectionStatus(
    sessionId: string, 
    socketId: string, 
    connected: boolean
  ): Promise<void> {
    const session = await this.findSession(sessionId);
    if (session) {
      if (connected) {
        if (!session.socketIds.includes(socketId)) {
          session.socketIds.push(socketId);
        }
      } else {
        session.socketIds = session.socketIds.filter(id => id !== socketId);
      }
      
      session.connected = session.socketIds.length > 0;
      session.lastActive = Date.now();
      
      await this.saveSession(session);
    }
  }

  async removeSocket(sessionId: string, socketId: string): Promise<boolean> {
    const session = await this.findSession(sessionId);
    if (session) {
      session.socketIds = session.socketIds.filter(id => id !== socketId);
      session.connected = session.socketIds.length > 0;
      session.lastActive = Date.now();
      
      await this.saveSession(session);
      return session.socketIds.length === 0;
    }
    return true;
  }

  // This method is now a no-op since Redis TTL handles expiration automatically

} 