import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import type {
  ChatMessage,
  SocketData, 
  ClientAdditionalData
} from '../../types'

import { 
  CHAT_ROOMS_PREFIX,
  CLIENT_SOCKETS_PREFIX,
  API_KEY_CLIENTS_PREFIX,
  OFFLINE_MESSAGES_PREFIX,
  CLIENT_ADDITIONAL_DATA_PREFIX
} from '../../types';


export const handleChat = (
  io: Server,
  socket: Socket<any, any, any, SocketData>,
  redis: Redis
) => {
  const { clientId, apiKey, socketId } = socket.data

  const storeClientData = async (userId: string, data?: ClientAdditionalData) => {
    if (!data) return;

    if (Object.keys(data).length > 0) {
      const clientDataKey = `${apiKey}:${CLIENT_ADDITIONAL_DATA_PREFIX}${userId}`;
      await redis.set(clientDataKey, JSON.stringify(data));
      await redis.expire(clientDataKey, 60 * 60 * 24 * 30);
    }
  };

  const getClientData = async (userId: string): Promise<ClientAdditionalData | undefined> => {
    const clientDataKey = `${apiKey}:${CLIENT_ADDITIONAL_DATA_PREFIX}${userId}`;
    const clientData = await redis.get(clientDataKey);

    if(clientData) {
      return JSON.parse(clientData);
    }
    return undefined;
  };

  socket.on('chat:Profile_update', async (data: ClientAdditionalData) => {
    try {
      await storeClientData(clientId, data);
      socket.emit('chat:Profile_update');
    } catch (error) {
      console.error('Error updating client data:', error);
      socket.emit('chat:error', { message: 'Failed to update client data' });
    }
  });
    


  const joinPrivateRoom = async (targetClientId: string): Promise<string | null > => {

    const roomId = [clientId, targetClientId].sort().join('_');
    const roomKey = `${apiKey}:${CHAT_ROOMS_PREFIX}${roomId}`;

    await redis.sadd(roomKey, clientId, targetClientId);

    const apiKeyClientsKey = `${API_KEY_CLIENTS_PREFIX}${apiKey}`;
    await redis.sadd(apiKeyClientsKey, targetClientId);

    socket.join(roomId);

    return roomId;
  };

  // Handle private message
  socket.on('chat:private', async (data: { 
    targetId: string; 
    message: string;
    clientAdditionalData?: ClientAdditionalData
  }) => {
    try {
      const { targetId, message, clientAdditionalData } = data;

      if (clientAdditionalData) {
        await storeClientData(clientId, clientAdditionalData);
      }

      const roomId = await joinPrivateRoom(targetId);
      const safeRoomId = roomId || [clientId, targetId].sort().join('_');

      const fromData = await getClientData(clientId);
      const toData = await getClientData(targetId);

      const messageData: ChatMessage = {
        messageId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        roomId: safeRoomId,
        message,
        fromId: clientId,
        toId: targetId,
        timestamp: new Date().toISOString(),
        fromData,
        toData,
      };

      const recipientSocketsKey = `${apiKey}:${CLIENT_SOCKETS_PREFIX}${targetId}`;
      const recipientSockets = await redis.smembers(recipientSocketsKey);

      if(recipientSockets.length > 0) {
        // Join all recipient sockets to the room
        for (const recipientSocketId of recipientSockets) {
          const recipientSocket = io.sockets.sockets.get(recipientSocketId);
          if (recipientSocket) {
            recipientSocket.join(safeRoomId);
            console.log(`Joined recipient socket ${recipientSocketId} to room ${roomId}`);
          }
        }
        
        // Now broadcast to the room (both sender and recipient will receive)
        io.to(safeRoomId).emit('chat:message', messageData);
        socket.emit('chat:delivered', { messageId: messageData.messageId });
      } else {
        // Handle offline message as before
        const offlineKey = `${apiKey}:${OFFLINE_MESSAGES_PREFIX}${targetId}`;
        await redis.lpush(offlineKey, JSON.stringify(messageData));

        socket.emit('chat:message', messageData);
        socket.emit('chat:delivered', { messageId: messageData.messageId });
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
        fromId: clientId, 
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


        if (!messageData.fromData) {
          const senderData = await getClientData(messageData.senderId);
          if (senderData) {
            messageData.fromData = senderData;
          }
        }


        if (!messageData.toData) {
          const recipientData = await getClientData(clientId);
          if (recipientData) {
            messageData.toData = recipientData;
          }
        }

        const roomId = messageData.roomId;
        socket.join(roomId);

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
