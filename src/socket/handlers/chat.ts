import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import type {
  ChatMessage,
  SocketData, 
  ClientMetaData
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
    metaData?: ClientMetaData;
  }) => {
    try {
      const { targetId, message, metaData } = data;

      //const fromData = await getClientData(clientId);
      //const toData = await getClientData(targetId);


      const roomId = await joinPrivateRoom(targetId);
      const safeRoomId = roomId || [clientId, targetId].sort().join('_');


      const messageData: ChatMessage = {
        messageId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        roomId: safeRoomId,
        message,
        fromId: clientId,
        //toId: targetId,
        timestamp: new Date().toISOString(),
        metaData,
        //toData,
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

  socket.on('chat:profile_update', async (data: ClientMetaData) => {
    try {
      console.log('Received profile update:', data, 'for client:', clientId);

      if (data) {
      await storeClientData(clientId, data);
      socket.emit('chat:profile_updated');
      console.log('Profile updated for client:', clientId);
      }
    } catch (error) {
      console.error('Error updating client data:', error);
      socket.emit('chat:error', { message: 'Failed to update client data' });
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

async function storeClientData(clientId: string, data: ClientMetaData) {
  try {
    const key = `${apiKey}:${CLIENT_ADDITIONAL_DATA_PREFIX}${clientId}`;
    
    const jsonData = JSON.stringify(data);
    await redis.set(key, jsonData);
    console.log(`Stored client data for ${clientId}:`, data);
    return true;
  } catch (error) {
    console.error('Error storing client data:', error);
    throw error;
  }
}

async function getClientData(clientId: string): Promise<ClientMetaData | undefined> {
  try {
    const key = `${apiKey}:${CLIENT_ADDITIONAL_DATA_PREFIX}${clientId}`;
    const data = await redis.get(key);
    
    if (data) {
      return JSON.parse(data);
    }
    return undefined;
  } catch (error) {
    console.error('Error getting client data:', error);
    return undefined;
  }
}


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
