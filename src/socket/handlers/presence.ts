import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import {
  Presence,
  API_KEY_CLIENTS_PREFIX
 } from '../../types';

const PRESENCE_PREFIX = 'presence:';
//const PRESENCE_TTL = 70000;
const PRESENCE_TTL = 3431;

export const handlePresence = (
  io: Server,
  socket: Socket,
  redis: Redis
) => {
  const { clientId, apiKey } = socket.handshake.auth;
  const presenceKey = `${apiKey}:${PRESENCE_PREFIX}${clientId}`;

  const enterPresence = async (): Promise<void> => {
    console.log(`Initializing presence for client ${clientId} with socket ${socket.id}`);
    
    const presence: Presence = {
      status: 'online',
      customMessage: '',
      lastUpdated: new Date().toISOString(),
      socketId: socket.id,
    };

    await redis.hset(presenceKey, presence);
    await redis.expire(presenceKey, PRESENCE_TTL);
    
    const apiKeyClientsKey = `${API_KEY_CLIENTS_PREFIX}${apiKey}`;
    const members = await redis.smembers(apiKeyClientsKey);

    const existingMembers = await Promise.all(
      members.map(async (memberId) => {
        const memberPresence = await redis.hgetall(`${apiKey}:${PRESENCE_PREFIX}${memberId}`);
        return memberPresence ? {
          clientId: memberId,
          presence: memberPresence
        } : null;
      })
    ).then(results => results.filter(Boolean));

    socket.emit('presence:sync', existingMembers);

    //io.to(`key:${apiKey}`).emit('presence:enter', {
    //  clientId,
   //   presence
   // });
   console.log(`Emitting presence:enter event to key:${apiKey}`);
   const sockets = await io.in(`key:${apiKey}`).fetchSockets();
   for (const targetSocket of sockets) {
    if (targetSocket.id !== socket.id) {
      // This will use the overridden emit method that handles encryption
      targetSocket.emit('presence:enter', { clientId, presence });
    }
  }
  };

  const cleanup = async (isLastSocket: boolean): Promise<void> => {
    if (isLastSocket) {
      io.to(`key:${apiKey}`).emit('presence:leave', {
        clientId
      });

      await redis.del(presenceKey);
    }
  };

  socket.on('presence:update', async (rawData: any) => {
    const data = rawData.data ? rawData.data : rawData;
    const { status, customMessage } = data;
    
    console.log(`PRESENCE UPDATE HANDLER TRIGGERED for client ${clientId}: status=${status}, message=${customMessage}`);
    const presence: Presence = {
      status,
      customMessage,
      lastUpdated: new Date().toISOString(),
      socketId: socket.id
    };

    await redis.hset(presenceKey, presence);
    await redis.expire(presenceKey, PRESENCE_TTL);
    
    console.log(`Emitting presence:update event to key:${apiKey}`);
    //io.to(`key:${apiKey}`).emit('presence:update', { clientId, presence });
    const sockets = await io.in(`key:${apiKey}`).fetchSockets();
    for (const targetSocket of sockets) {
      // This will use the overridden emit method that handles encryption
      targetSocket.emit('presence:update', { clientId, presence });
    }
  });

  socket.on('presence:heartbeat', async () => {
    const now = Date.now();
    await redis.hset(presenceKey, {
      lastHeartbeat: now,
      lastUpdated: new Date().toISOString()
    });
    await redis.expire(presenceKey, PRESENCE_TTL);
  });


  return {
    enterPresence,
    cleanup
  };
};