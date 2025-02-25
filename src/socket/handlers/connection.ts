import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { SocketState } from '../state';

const SOCKET_MAP_PREFIX = 'socket:map:';
const CLIENT_SOCKETS_PREFIX = 'client:sockets:';
const API_KEY_CLIENTS_PREFIX = 'apikey:clients:';

export const handleConnection = (
  io: Server,
  socket: Socket,
  redis: Redis
) => {
  const { clientId, apiKey } = socket.handshake.auth;

  // Store socket mapping in Redis
  const socketMapKey = `${SOCKET_MAP_PREFIX}${socket.id}`;
  const clientSocketsKey = `${CLIENT_SOCKETS_PREFIX}${clientId}`;
  const apiKeyClientsKey = `${API_KEY_CLIENTS_PREFIX}${apiKey}`;

  // Using Promise.all for parallel Redis operations
  Promise.all([
    // Map socket to client info
    redis.hset(socketMapKey, {
      clientId,
      apiKey,
      socketId: socket.id
    }),
    
    // Add socket to client's socket list
    redis.sadd(clientSocketsKey, socket.id),
    
    // Add client to API key's client list
    redis.sadd(apiKeyClientsKey, clientId)
  ]).catch(err => {
    console.error('Redis connection state error:', err);
  });

  // Join API key room
  socket.join(`key:${apiKey}`);

  return {
    cleanup: async () => {
      console.log(`Client ${clientId} disconnecting, cleaning up...`);
      
      try {
        // Get remaining sockets for this client
        const remainingSockets = await redis.srem(clientSocketsKey, socket.id)
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
          }
        };
      } catch (err) {
        console.error('Redis cleanup error:', err);
        return {
          isLastSocket: false,
          leaveRoom: () => {
            socket.leave(`key:${apiKey}`);
          }
        };
      }
    }
  };
};