import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import type { SocketData, SessionStore } from '../types';

// Utility function to mask sensitive data
const maskSensitive = (text: string, showLength: number = 4): string => {
  if (!text) return '';
  const visiblePart = text.slice(0, showLength);
  return `${visiblePart}${'*'.repeat(text.length - showLength)}`;
};

// Socket authentication middleware
export const socketMiddleware = (
  sessionStore: SessionStore
) => async (
  socket: Socket<any, any, any, SocketData>,  
  next: (err?: Error) => void
): Promise<void> => {
    const { clientId, apiKey, sessionId } = socket.handshake.auth;
  
    if (!clientId || !apiKey) {
      console.log('Connection rejected: Missing credentials');
      return next(new Error('Authentication failed: Missing clientId or apiKey'));
    }

    try {
      const userAgent = socket.handshake.headers['user-agent'];
      const ip = socket.handshake.address;


      if(sessionId) {
        const session =  await sessionStore.findSession(sessionId);

        if(session && session.clientId === clientId) {

        console.log(`Valid session found for client ${maskSensitive(clientId)}`);
        await sessionStore.updateConnectionStatus(sessionId, socket.id, true);
        
        socket.data = {
        clientId,
        apiKey,
        socketId: socket.id,
        sessionId: session.sessionId
      };


      console.log(`Returning user with session ${maskSensitive(sessionId, 8)}`);
      console.log(`Updated session with socket ${socket.id}`);

      return next();
    }
  }

      const newSessionId = uuidv4();
      
      // Create and save the new session
      await sessionStore.createSession({
        sessionId: newSessionId,
        clientId,
        connected: true,
        lastActive: Date.now(),
        userAgent,
        ip,
        socketIds: [socket.id]
      });
      
      // Store session data in socket
      socket.data = {
        clientId,
        apiKey,
        socketId: socket.id,
        sessionId: newSessionId
      };

      
      console.log(`Created new session ${maskSensitive(newSessionId, 8)} for client ${maskSensitive(clientId)}`);
      console.log(`Using API key: ${maskSensitive(apiKey)}`);
      
      // Send the sessionId to the client
      
      next();
    } catch (error) {
      console.error('Session handling error:', error);
      console.error(error);
      next(new Error('Authentication failed: Session error'));
    }
};