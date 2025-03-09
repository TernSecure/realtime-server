import { v4 as uuidv4 } from 'uuid';
import type { Session, SessionStore } from '../../types';

export class InMemorySessionStore implements SessionStore {
  private sessions: Map<string, Session> = new Map();
  private clientToSession: Map<string, string> = new Map();
  
  async findSession(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) || null;
  }

  async findSessionByClientId(clientId: string): Promise<Session | null> {
    const sessionId = this.clientToSession.get(clientId);
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
    this.sessions.set(session.sessionId, session);
    this.clientToSession.set(session.clientId, session.sessionId);
  }

  async updateConnection(session: Session): Promise<void> {
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

  async cleanupInactiveSessions(maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
    const now = Date.now();
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (!session.connected && now - session.lastActive > maxAge) {
        this.sessions.delete(sessionId);
        this.clientToSession.delete(session.clientId);
      }
    }
  }
}
