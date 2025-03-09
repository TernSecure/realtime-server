import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import type { SocketData, SessionStore } from '../types';


// Socket authentication middleware
export const socketMiddleware = (
  sessionStore: SessionStore
) => async (
  socket: Socket<any, any, any, SocketData>,  
  next: (err?: Error) => void
): Promise<void> => {
    const {  sessionId } = socket.handshake.auth;

  
    if (!sessionId) {
      console.log('Connection rejected: Missing session ID');
      return next(new Error('Authentication failed: Missing sessionId'));
    }
    try {
      const userAgent = socket.handshake.headers['user-agent'];
      const ip = socket.handshake.address;
      const session =  await sessionStore.findSession(sessionId);
      //const ipAddress = socket.handshake.headers["x-forwarded-for"].split(",")[0];

      if (!session) {
        console.log(`Invalid session ID: ${sessionId}`);
        return next(new Error('Authentication failed: Invalid session ID'));
      }

        
        socket.data = {
        clientId: session.clientId,
        apiKey: session.apiKey || '',
        socketId: socket.id,
        sessionId: sessionId
      }
      
      next();
    } catch (error) {
      console.error('Session handling error:', error);
      console.error(error);
      next(new Error('Authentication failed: Session error'));
    }
};