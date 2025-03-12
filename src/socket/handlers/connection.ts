import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import type { SocketData } from '../../types';
import {
  CLIENT_SOCKETS_PREFIX,
  SOCKET_MAP_PREFIX,
  API_KEY_CLIENTS_PREFIX
} from '../../types'
import { 
  getServerPublicKey, encryptForClient, decryptFromClient, hasClientPublicKey, 
  encryptAndPackMessage,
  decryptAndUnpackMessage
  } from '../../middleware';

const SOCKET_MAP_TTL = 24 * 60 * 60;


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
    const sessionId = socket.data.sessionId; 
    const encryptionReady = socket.data.encryptionReady;

    console.log('from connection:',encryptionReady)

    console.log('Encryption state check:', {
      socketEncryptionReady: socket.data.encryptionReady,
      event,
      clientId
    });


    if (socket.data.encryptionReady) {
      try {
        const encryptedBuffer = encryptAndPackMessage(clientId, sessionId, event, payload);
        if (encryptedBuffer) {
          console.log(`Sending encrypted binary message for event: ${event}`);
          return originalEmit.call(this, 'binary', encryptedBuffer, true);
        } else {
          console.warn('encryptAndPackMessage returned null');
        }
      } catch (error) {
        console.error(`Encryption error for event ${event}:`, error);
      }
    } else {
      console.log(`Encryption not ready. Sending unencrypted. Ready: ${socket.data.encryptionReady}, HasKey: ${hasClientPublicKey(clientId, sessionId)}`);
      const binaryBuffer = Buffer.from(JSON.stringify({ event, data: payload }));
      return originalEmit.call(this, 'binary', binaryBuffer, false);
    }
    
    // Fallback to regular Socket.IO
    console.warn(`Falling back to regular transmission for event: ${event}`);
    return originalEmit.apply(this, [event, ...args]);
  };

  socket.on('binary', async (data: Buffer | ArrayBuffer, isEncrypted: boolean) => {
    try {
      if (isEncrypted && socket.data.encryptionReady) {
        // Handle encrypted binary data
        const message = await decryptAndUnpackMessage(clientId, sessionId, data);
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

  //socket.emit("session", {
  //  sessionId: sessionId,
  //  serverPublicKey: getServerPublicKey()
  //});

  //socket.on('client:publicKey', (publicKey: string) => {
   // setClientPublicKey(clientId, publicKey);
  //  console.log(`Received public key from client ${clientId}`);
    
    // Notify client that encryption is ready
   // socket.emit('encryption:ready');
  //});

  console.log(`Sent session ID ${sessionId} to client ${clientId}`);

  // Store socket mapping in Redis
  const socketMapKey = `${apiKey}:${SOCKET_MAP_PREFIX}${socketId}`;
  const clientSocketsKey = `${apiKey}:${CLIENT_SOCKETS_PREFIX}${clientId}`;
  const apiKeyClientsKey = `${API_KEY_CLIENTS_PREFIX}${apiKey}`;

{/*  redis.multi()
  // Map socket to client info
  .hset(socketMapKey, {
    clientId,
    apiKey,
    socketId,
    sessionId
  })
  .expire(socketMapKey, SOCKET_MAP_TTL)  // Add TTL to socket mapping
  
  // Add socket to client's socket list
  .sadd(clientSocketsKey, socketId)
  .expire(clientSocketsKey, SOCKET_MAP_TTL)  // Add TTL to client sockets
  
  // Add client to API key's client list
  .sadd(apiKeyClientsKey, clientId)
  .expire(apiKeyClientsKey, SOCKET_MAP_TTL)  // Add TTL to API key clients
  .exec()
  .catch(err => {
    console.error('Redis connection state error:', err);
  }); */}

  // Using Promise.all for parallel Redis operations
  Promise.all([
    // Map socket to client info
    redis.hset(socketMapKey, {
      clientId,
      apiKey,
      socketId,
      sessionId
    }),
    redis.expire(socketMapKey, SOCKET_MAP_TTL),
    
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