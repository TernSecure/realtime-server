import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import type {
  ChatMessage,
  SocketData
} from '../../types'

import { 
  CHAT_ROOMS_PREFIX,
  CLIENT_SOCKETS_PREFIX,
  API_KEY_CLIENTS_PREFIX,
  OFFLINE_MESSAGES_PREFIX
} from '../../types';


export const handleChat = (
  io: Server,
  socket: Socket<any, any, any, SocketData>,
  redis: Redis
) => {
  const { clientId, apiKey, socketId } = socket.data


  const joinPrivateRoom = async (targetClientId: string): Promise<string | null > => {

    const apiKeyClientsKey = `${API_KEY_CLIENTS_PREFIX}${apiKey}`;
    const exists = await redis.sismember(apiKeyClientsKey, targetClientId);

    if (!exists) {
      return null;
    }

    const roomId = [clientId, targetClientId].sort().join('_');
    const roomKey = `${apiKey}:${CHAT_ROOMS_PREFIX}${roomId}`;

    await redis.sadd(roomKey, clientId, targetClientId);
    socket.join(roomId);

    return roomId;
  };

  // Handle private message
  socket.on('chat:private', async (data: { targetId: string; message: string }) => {
    try {
      const { targetId, message } = data;
      const roomId = await joinPrivateRoom(targetId);

      if (!roomId) {
        socket.emit('chat:error', {
          message: 'Cannot chat with user from different API key'
        });
        return;
      }

      const messageData: ChatMessage = {
        messageId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        roomId,
        message,
        senderId: clientId,
        timestamp: new Date().toISOString(),
        apiKey
      };

      const recipientSocketsKey = `${apiKey}:${CLIENT_SOCKETS_PREFIX}${targetId}`;
      const recipientSockets = await redis.smembers(recipientSocketsKey);

      if(recipientSockets.length > 0) {
        io.to(roomId).emit('chat:message', messageData);
        socket.emit('chat:delivered', { messageId: messageData.messageId });
      } else {
        const offlineKey = `${apiKey}:${OFFLINE_MESSAGES_PREFIX}${targetId}`;
        await redis.lpush(offlineKey, JSON.stringify(messageData));
      }

    } catch (error) {
      console.error('Error handling private message:', error);
      socket.emit('chat:error', { message: 'Failed to send message' });
    }
  });

  // Handle typing indicator within same API key
  socket.on('chat:typing', async ({ targetId, isTyping }: { targetId: string; isTyping: boolean }) => {
    const roomId = await joinPrivateRoom(targetId);
    if (roomId) {
      socket.to(roomId).emit('chat:typing', {
        senderId: clientId, 
        isTyping 
      });
    }
  });

  const deliverOfflineMessages = async () => {
    const offlineKey = `${apiKey}:${OFFLINE_MESSAGES_PREFIX}${clientId}`;
    const messages = await redis.lrange(offlineKey, 0, -1);

    if (messages.length > 0) {
      for (const msg of messages) {
        const messageData = JSON.parse(msg);
        socket.emit('chat:message', messageData);
      }
      await redis.del(offlineKey);
    }
  };

  deliverOfflineMessages().catch(console.error);

  return {
    cleanup: async () => {
      // Leave all rooms
      const rooms = Array.from(socket.rooms);
      for (const room of rooms) {
        if (room !== socketId) {
          const roomKey = `${apiKey}:${CHAT_ROOMS_PREFIX}${room}`;
          await redis.srem(roomKey, clientId);
          socket.leave(room);
        }
      }
    }
  };
};
