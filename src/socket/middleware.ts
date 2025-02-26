import { Socket } from 'socket.io';
import type { SocketData } from '../types';

// Utility function to mask sensitive data
const maskSensitive = (text: string, showLength: number = 4): string => {
  if (!text) return '';
  const visiblePart = text.slice(0, showLength);
  return `${visiblePart}${'*'.repeat(text.length - showLength)}`;
};

// Socket authentication middleware
export const socketMiddleware = (
  socket: Socket<any, any, any, SocketData>,  
  next: (err?: Error) => void
): void => {
    const { clientId, apiKey } = socket.handshake.auth;
  
    if (!clientId || !apiKey) {
      console.log('Connection rejected: Missing credentials');
      return next(new Error('Authentication failed: Missing clientId or apiKey'));
    }


    socket.data = {
      clientId,
      apiKey,
      socketId: socket.id,
    };
  
    console.log(`Authentication successful for client ${maskSensitive(clientId)}`);
    console.log(`Using API key: ${maskSensitive(apiKey)}`);

    next();
};