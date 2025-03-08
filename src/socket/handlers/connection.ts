import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import type { SocketData } from '../../types';
import {
  CLIENT_SOCKETS_PREFIX,
  SOCKET_MAP_PREFIX,
  API_KEY_CLIENTS_PREFIX
} from '../../types'
import { 
  getServerPublicKey, setClientPublicKey, encryptForClient, decryptFromClient, hasClientPublicKey, 
  encryptAndPackMessage,
  decryptAndUnpackMessage
  } from '../../middleware';

//const UNENCRYPTED_EVENTS = ['session', 'client:publicKey', 'encryption:ready'];
const UNENCRYPTED_EVENTS: string[] = [];

function packMessageAsBinary(event: string, data: any): ArrayBuffer {
  try {
    // Convert the event and data to a JSON string
    const jsonString = JSON.stringify({ event, data });
    
    // Convert the JSON string to a Uint8Array
    const encoder = new TextEncoder();
    const binaryData = encoder.encode(jsonString);
    
    return binaryData.buffer;
  } catch (error) {
    console.error('Error packing message as binary:', error);
    return new ArrayBuffer(0);
  }
}


function setupBinaryTransmission(socket: Socket) {
  const clientId = socket.data?.clientId;
  const sessionId = socket.data?.sessionId;
  if (!clientId || !sessionId) return;
  
  // Store the original emit method
  const originalEmit = socket.emit;
  
  // Override emit to encrypt data and send as binary
  socket.emit = function(event: string, ...args: any[]): boolean {
    const payload = args[0];
    // Skip encryption for certain events

    if (hasClientPublicKey(clientId) && !UNENCRYPTED_EVENTS.includes(event)) {
      try {
        // Encrypt and send as binary
        const encryptedBinaryData = encryptAndPackMessage(clientId, event, payload);
        if (encryptedBinaryData) {
          console.log(`Sending encrypted binary message for event: ${event}`);
          return originalEmit.apply(this, ['binary', encryptedBinaryData, true]); // true flag indicates encrypted
        }
      } catch (error) {
        console.error(`Error encrypting message for event ${event}:`, error);
      }
    }

    try {
      const binaryData = packMessageAsBinary(event, payload);
      if (binaryData.byteLength > 0) {
        console.log(`Sending unencrypted binary message for event: ${event}`);
        return originalEmit.apply(this, ['binary', binaryData, false]); // false flag indicates unencrypted
      }
    } catch (error) {
      console.error(`Error packing message as binary for event ${event}:`, error);
    }
    
    // Fallback to regular Socket.IO
    console.warn(`Falling back to regular transmission for event: ${event}`);
    return originalEmit.apply(this, [event, ...args]);
  };

  socket.on('binary', (data: ArrayBuffer, isEncrypted: boolean) => {
    try {
      if (isEncrypted) {
        // Handle encrypted binary data
        const message = decryptAndUnpackMessage(clientId, data);
        if (message) {
          const { event, data: messageData } = message;
          console.log(`Received encrypted binary message for event: ${event}`);
          originalEmit.apply(socket, [event, messageData]);
        }
      } else {
        // Handle unencrypted binary data
        const decoder = new TextDecoder();
        const jsonString = decoder.decode(new Uint8Array(data));
        const { event, data: messageData } = JSON.parse(jsonString);
        console.log(`Received unencrypted binary message for event: ${event}`);
        originalEmit.apply(socket, [event, messageData]);
      }
    } catch (error) {
      console.error('Error processing binary message:', error);
    }
  });
}

export const handleConnection = (
  io: Server,
  socket: Socket<any, any, any, SocketData>,
  redis: Redis
) => {
  const { clientId, apiKey, socketId, sessionId } = socket.data;

  setupBinaryTransmission(socket);

  socket.emit("session", {
    sessionId: sessionId,
    serverPublicKey: getServerPublicKey()
  });

  socket.on('client:publicKey', (publicKey: string) => {
    setClientPublicKey(clientId, publicKey);
    console.log(`Received public key from client ${clientId}`);
    
    // Notify client that encryption is ready
    socket.emit('encryption:ready');
  });

  console.log(`Sent session ID ${sessionId} to client ${clientId}`);

  // Store socket mapping in Redis
  const socketMapKey = `${apiKey}:${SOCKET_MAP_PREFIX}${socketId}`;
  const clientSocketsKey = `${apiKey}:${CLIENT_SOCKETS_PREFIX}${clientId}`;
  const apiKeyClientsKey = `${API_KEY_CLIENTS_PREFIX}${apiKey}`;

  // Using Promise.all for parallel Redis operations
  Promise.all([
    // Map socket to client info
    redis.hset(socketMapKey, {
      clientId,
      apiKey,
      socketId,
      sessionId
    }),
    
    // Add socket to client's socket list
    redis.sadd(clientSocketsKey, socketId),
    
    // Add client to API key's client list
    redis.sadd(apiKeyClientsKey, clientId)
  ]).catch(err => {
    console.error('Redis connection state error:', err);
  });

  // Join API key room
  socket.join(`key:${apiKey}`);
  //socket.join(`client:${clientId}`);
  //socket.join(socket.data.clientId)
  socket.join(clientId);  

  //setupEncryption(socket);
  //setupBinaryEncryption(socket);
  

  function setupEncryption(socket: Socket) {
    // Store the original emit method
    const originalEmit = socket.emit;
    
    // Override emit to encrypt data
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
      
      if (encryptedPayload) {
        console.log(`Sending encrypted event: ${event} to client`, clientId);
        // Send encrypted data with event name
        return originalEmit.apply(this, [
          'encrypted', 
          { 
            event, 
            data: encryptedPayload 
          }
        ]);
      } else {
        console.warn(`Encryption failed for event: ${event}, sending unencrypted`);
        return originalEmit.apply(this, [event, ...args]);
      }
    };

    socket.on('encrypted', (encryptedPacket) => {
      const { event, data } = encryptedPacket;
      const clientId = socket.data?.clientId;
      
      if (!clientId) {
        console.error('Client ID not found for decryption');
        return;
      }
      
      const decryptedData = decryptFromClient(clientId, data);
      if (decryptedData) {
        console.log(`Received encrypted event: ${event} from client`, clientId);
        // Process the decrypted event
        socket.emit(event, decryptedData);
      } else {
        console.error(`Failed to decrypt message for event: ${event}`);
      }
    });
  }



  return {
    cleanup: async () => {
      console.log(`Client ${clientId} disconnecting, cleaning up...`);
      
      try {
        // Get remaining sockets for this client
        const remainingSockets = await redis.srem(clientSocketsKey, socketId)
          .then(() => redis.smembers(clientSocketsKey));
        
        const isLastSocket = remainingSockets.length === 0;

        if (isLastSocket) {
          // Clean up all client data if this was the last socket
          await Promise.all([
            redis.del(clientSocketsKey),
            redis.srem(apiKeyClientsKey, clientId),
            // Check if this was the last client for this API key
            redis.smembers(apiKeyClientsKey).then(async (clients) => {
              if (clients.length === 0) {
                await redis.del(apiKeyClientsKey);
              }
            })
          ]);
        }

        // Always clean up socket mapping
        await redis.del(socketMapKey);
        
        console.log('Cleanup completed for client:', clientId);
        
        return {
          isLastSocket,
          leaveRoom: () => {
            socket.leave(`key:${apiKey}`);
            socket.leave(clientId);
          }
        };
      } catch (err) {
        console.error('Redis cleanup error:', err);
        return {
          isLastSocket: false,
          leaveRoom: () => {
            socket.leave(`key:${apiKey}`);
            socket.leave(clientId);
          }
        };
      }
    }
  };
};