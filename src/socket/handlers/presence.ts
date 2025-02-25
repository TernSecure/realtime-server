import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { Presence } from '../../types';

const PRESENCE_PREFIX = 'presence:';
const PRESENCE_TTL = 70000;

export const handlePresence = (
  io: Server,
  socket: Socket,
  redis: Redis
) => {
  const { clientId, apiKey } = socket.handshake.auth;
  const presenceKey = `${PRESENCE_PREFIX}${clientId}`;

  const enterPresence = async (): Promise<void> => {
    console.log(`Initializing presence for client ${clientId} with socket ${socket.id}`);
    
    const presence: Presence = {
      status: 'online',
      customMessage: '',
      lastUpdated: new Date().toISOString(),
      socketId: socket.id
    };

    await redis.hset(presenceKey, presence);
    await redis.expire(presenceKey, PRESENCE_TTL);
    
    const apiKeyClientsKey = `apikey:clients:${apiKey}`;
    const members = await redis.smembers(apiKeyClientsKey);

    const existingMembers = await Promise.all(
      members.map(async (memberId) => {
        const memberPresence = await redis.hgetall(`${PRESENCE_PREFIX}${memberId}`);
        return memberPresence ? {
          clientId: memberId,
          presence: memberPresence
        } : null;
      })
    ).then(results => results.filter(Boolean));

    socket.emit('presence:sync', existingMembers);

    io.to(`key:${apiKey}`).emit('presence:enter', {
      clientId,
      presence
    });
  };

  const cleanup = async (isLastSocket: boolean): Promise<void> => {
    if (isLastSocket) {
      io.to(`key:${apiKey}`).emit('presence:leave', {
        clientId
      });

      await redis.del(presenceKey);
    }
  };

  socket.on('presence:update', async ({ status, customMessage }: { status: string; customMessage: string }) => {
    const presence: Presence = {
      status,
      customMessage,
      lastUpdated: new Date().toISOString(),
      socketId: socket.id
    };

    await redis.hset(presenceKey, presence);
    await redis.expire(presenceKey, PRESENCE_TTL);

    io.to(`key:${apiKey}`).emit('presence:update', { clientId, presence });
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