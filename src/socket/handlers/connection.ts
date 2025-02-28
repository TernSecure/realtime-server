import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import type { SocketData } from '../../types';
import {
  CLIENT_SOCKETS_PREFIX,
  SOCKET_MAP_PREFIX,
  API_KEY_CLIENTS_PREFIX
} from '../../types'

export const handleConnection = (
  io: Server,
  socket: Socket<any, any, any, SocketData>,
  redis: Redis
) => {
  const { clientId, apiKey, socketId, sessionId } = socket.data;

  socket.emit("session", {
    sessionId: sessionId
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
  socket.join(socket.data.clientId)

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
            socket.leave(`client:${clientId}`);
          }
        };
      } catch (err) {
        console.error('Redis cleanup error:', err);
        return {
          isLastSocket: false,
          leaveRoom: () => {
            socket.leave(`key:${apiKey}`);
            socket.leave(`client:${clientId}`);
          }
        };
      }
    }
  };
};