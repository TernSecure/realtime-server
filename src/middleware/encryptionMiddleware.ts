import { Server } from 'socket.io';
import { encryptForClient, decryptFromClient, hasClientPublicKey } from './encryption';

// Events that should not be encrypted
const UNENCRYPTED_EVENTS = ['session', 'client:publicKey', 'encryption:ready'];

export const createEncryptionMiddleware = (io: Server) => {
  // Outgoing messages - encrypt before sending
  io.engine.on("connection", (rawSocket) => {
    // Get the Socket.IO socket instance
    const socket = io.sockets.sockets.get(rawSocket.id);
    if (!socket) return;

    // Override emit to encrypt data
    const originalEmit = socket.emit;
    socket.emit = function(event: string, ...args: any[]) {
      // Skip encryption for certain events
      if (UNENCRYPTED_EVENTS.includes(event)) {
        return originalEmit.apply(this, [event, ...args]);
      }

      const clientId = socket.data?.clientId;
      if (!clientId || !hasClientPublicKey(clientId)) {
        return originalEmit.apply(this, [event, ...args]);
      }

      // Encrypt the payload
      const payload = args[0];
      const encryptedPayload = encryptForClient(clientId, payload);

      console.log(' encrytion middleware:', clientId, encryptedPayload)
      
      if (encryptedPayload) {
        // Send encrypted data with event name
        return originalEmit.apply(this, [
          'encrypted', 
          { 
            event, 
            data: encryptedPayload 
          }
        ]);
      } else {
        // Fallback to unencrypted if encryption fails
        return originalEmit.apply(this, [event, ...args]);
      }
    };
  });

  // Incoming messages - decrypt before processing
  io.use((socket, next) => {
    socket.on('encrypted', (encryptedPacket) => {
      const { event, data } = encryptedPacket;
      const clientId = socket.data?.clientId;
      
      if (!clientId) {
        return next(new Error('Client ID not found'));
      }
      
      const decryptedData = decryptFromClient(clientId, data);
      if (decryptedData) {
        // Use a public method instead of onevent
        socket.emit(event, decryptedData);
      }
    });
    
    next();
  });
};