import { Server } from 'socket.io';
import { encryptForClient, decryptFromClient, hasClientPublicKey } from './encryption';

// Events that should not be encrypted
const UNENCRYPTED_EVENTS = ['session', 'client:publicKey', 'encryption:ready'];

export const createEncryptionMiddleware = (io: Server) => {
  // Override the emit method for all sockets
  const originalEmit = io.sockets.emit;
  
  // Outgoing messages - encrypt before sending
  io.engine.on("connection", (rawSocket) => {
    // Get the Socket.IO socket instance
    const socket = io.sockets.sockets.get(rawSocket.id);
    if (!socket) return;

    // Store the original emit method
    const originalSocketEmit = socket.emit;
    
    // Override emit to encrypt data
    socket.emit = function(event: string, ...args: any[]) {
      // Skip encryption for certain events
      if (UNENCRYPTED_EVENTS.includes(event)) {
        console.log(`Sending unencrypted event: ${event}`);
        return originalSocketEmit.apply(this, [event, ...args]);
      }

      const clientId = socket.data?.clientId;
      const sessionId = socket.data?.sessionId;
      
      if (!clientId) {
        console.log(`Client ${clientId} has no public key, sending unencrypted: ${event}`);
        return originalSocketEmit.apply(this, [event, ...args]);
      }

      // Encrypt the payload
      const payload = args[0];
      const encryptedPayload = encryptForClient(clientId, sessionId, payload);
      
      if (encryptedPayload) {
        console.log(`Sending encrypted event: ${event} to client ${clientId}`);
        // Send encrypted data with event name
        return originalSocketEmit.apply(this, [
          'encrypted', 
          { 
            event, 
            data: encryptedPayload 
          }
        ]);
      } else {
        console.warn(`Encryption failed for event: ${event}, sending unencrypted`);
        return originalSocketEmit.apply(this, [event, ...args]);
      }
    };
    
    // Also override the to().emit() method for rooms
    const originalTo = socket.to;
    socket.to = function(room) {
      const originalRoomEmit = originalTo.apply(this, [room]).emit;
      const roomSocket = originalTo.apply(this, [room]);
      
      roomSocket.emit = function(event, ...args) {
        // For room broadcasts, we can't encrypt individually
        // This is a limitation - room messages will be unencrypted
        return originalRoomEmit.apply(this, [event, ...args]);
      };
      
      return roomSocket;
    };
  });

  // Incoming messages - decrypt before processing
  io.use((socket, next) => {
    socket.on('encrypted', (encryptedPacket) => {
      const { event, data } = encryptedPacket;
      const clientId = socket.data?.clientId;
      const sessionId = socket.data?.sessionId;
      
      if (!clientId) {
        console.error('Client ID not found for decryption');
        return;
      }
      
      const decryptedData = decryptFromClient(clientId, sessionId, data);
      if (decryptedData) {
        console.log(`Received encrypted event: ${event} from client ${clientId}`);
        // Emit the decrypted event internally
        socket.emit(event, decryptedData);
      } else {
        console.error(`Failed to decrypt message for event: ${event}`);
      }
    });
    
    next();
  });
};