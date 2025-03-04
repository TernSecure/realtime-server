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
import { RedisMessageStore } from '../messages/redisMessageStore';



export const handleChat = (
  io: Server,
  socket: Socket<any, any, any, SocketData>,
  redis: Redis
) => {
  const { clientId, apiKey, socketId } = socket.data
  const messageStore = new RedisMessageStore(redis);

  const statusSubscribers = new Set<string>();

  socket.on('chat:subscribe_status', () => {
    statusSubscribers.add(socketId);
    console.log(`Socket ${socketId} subscribed to status updates`);
  });
  
  socket.on('chat:unsubscribe_status', () => {
    statusSubscribers.delete(socketId);
    console.log(`Socket ${socketId} unsubscribed from status updates`);
  });

  const sendStatusUpdate = (targetSocketId: string, messageId: string, status: string) => {
    // Only send if the socket is subscribed to status updates
    if (statusSubscribers.has(targetSocketId)) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('chat:status', { messageId, status });
      }
    }
  };
    

  const joinPrivateRoom = async (targetId: string): Promise<string> => {
    // Create a consistent room ID based on the two user IDs
    const participants = [clientId, targetId].sort();
    const roomId = `${participants[0]}_${participants[1]}`;
    const roomKey = `${apiKey}:${CHAT_ROOMS_PREFIX}${roomId}`;
    
    if (socket.rooms.has(roomId)) {
      console.log(`Socket ${socketId} already in room ${roomId}`);
      return roomId;
    }
    
    await redis.sadd(roomKey, clientId, targetId);
    
    socket.join(roomId);
    console.log(`Joined socket ${socketId} to room ${roomId}`);
    
    return roomId;
  };

  // Handle private message
  socket.on('chat:private', async (data: { 
    targetId: string; 
    message: string;
    metaData?: ClientMetaData;
  }, callback?: (response: { success: boolean; messageId?: string; error?: string }) => void) => {
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
        timestamp: new Date().toISOString(),
        metaData,
      };

      await messageStore.saveMessage(apiKey, messageData);

      // Acknowledge message receipt to sender immediately
      if (callback) {
        callback({ 
          success: true, 
          messageId: messageData.messageId 
        });
      }

      const recipientSocketsKey = `${apiKey}:${CLIENT_SOCKETS_PREFIX}${targetId}`;
      const recipientSockets = await redis.smembers(recipientSocketsKey);

      socket.emit('chat:message', messageData); //Always send the message to the sender


      if(recipientSockets.length > 0) {
        // Join all recipient sockets to the room
        for (const recipientSocketId of recipientSockets) {
          const recipientSocket = io.sockets.sockets.get(recipientSocketId);
          if (recipientSocket) {
            if (!recipientSocket.rooms.has(roomId)) {
              recipientSocket.join(roomId)
            }
            //recipientSocket.join(safeRoomId);
            console.log(`Joined recipient socket ${recipientSocketId} to room ${roomId}`);

            recipientSocket.emit('chat:message', messageData);
          }
        }
        
        // Now broadcast to the room (both sender and recipient will receive)
        //io.to(safeRoomId).emit('chat:message', messageData);
        //socket.emit('chat:delivered', { messageId: messageData.messageId });

        for (const recipientSocketId of recipientSockets) {
          const recipientSocket = io.sockets.sockets.get(recipientSocketId);
          if (recipientSocket) {
            try {
              const response = await io.timeout(5000).to(recipientSocketId).emitWithAck('chat:status', {
                messageId: messageData.messageId,
                status: 'received'
              });

              if (response && response.received) {
                sendStatusUpdate(socketId, messageData.messageId, 'delivered');
                break;
              }
              //break;
            } catch (error) {
              continue;
            }
          }
        }
      } else {
        // Handle offline message as before
        const offlineKey = `${apiKey}:${OFFLINE_MESSAGES_PREFIX}${targetId}`;
        await redis.lpush(offlineKey, JSON.stringify(messageData));

        //socket.emit('chat:message', messageData);
        //socket.emit('chat:delivered', { messageId: messageData.messageId });
      }
    } catch (error) {
      console.error('Error handling private message:', error);
      socket.emit('chat:error', { message: 'Failed to send message' });
      if (callback){
        callback({ 
          success: false,
          error: 'Failed to send message'
        });
      }
    }
  });

  socket.on('chat:status', (
    data: { messageId: string, status: string },
    callback?: (response: { received: boolean }) => void
  ) => {
    try {
      // If this is a receipt confirmation request, acknowledge it
      if (data.status === 'received' && callback) {
        callback({ received: true });
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error handling message status:', error);
      if (callback) {
        callback({ received: false });
      }
      return { success: false };
    }
  });

  socket.on('chat:confirm_receipt', (
    data: { messageId: string },
    callback?: (response: { received: boolean }) => void
  ) => {
    try {
      if(callback) {
        callback({ received: true });
      }

      return { received: true };
    } catch (error) {
      if(callback) {
        callback({ received: false });
      }
      return { received: false };
    }
  });

  socket.on('chat:conversations', async(
    options: { limit?: number; offset?: number; },
    callback?: (response: {
      success: boolean;
      users?: any[];
      hasMore?: boolean;
      error?: string;
    }) => void
  ) => {
    try {
      const { limit =  50, offset = 0 } = options;

      const conversations = await messageStore.getRecentConversations(
        apiKey,
        clientId,
        limit
      );

      if (!conversations.length) {
        if(callback) {
          callback({
            success: true,
            users: [],
            hasMore: false
          });
        }
        return;
      }

    const userIds = conversations.map(conv => {

      const lastMsg = conv.lastMessage;
      if (!lastMsg) return null;

      return lastMsg.fromId === clientId ? lastMsg.toId : lastMsg.fromId;
    }).filter(id => id !== null && id !== undefined) as string[];

    const userDataPromises = userIds.map(async (userId) => {
      const userData = await getClientData(userId as string);

      return {
        id: userId,
        name: userData?.name || userId.substring(0, 8),
        email: userData?.email || '',
        avatar: userData?.avatar || ''
      };
    });

    const users = await Promise.all(userDataPromises);

    const paginatedUsers = users.slice(offset, offset + limit);
    const hasMore = users.length > offset + limit;

    if (callback) {
      callback({
        success: true,
        users: paginatedUsers,
        hasMore
      });
    }
  } catch (error) {
    console.error('Error fetching conversations:', error);
    if (callback) {
      callback({ 
        success: false, 
        error: 'Failed to fetch conversations'
      });
    }
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
 // socket.on('chat:typing', async ({ targetId, isTyping }: { targetId: string; isTyping: boolean }) => {
 //   const roomId = await joinPrivateRoom(targetId);
 //   if (roomId) {
 //     socket.to(roomId).emit('chat:typing', {
 //       fromId: clientId, 
 //       isTyping 
  //    });
 //   }
 // });

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
      statusSubscribers.delete(socketId);
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
