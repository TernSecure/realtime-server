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

  const STATUS_SUBSCRIBERS_KEY = `${apiKey}:message_status:status_subscribers`;
  const SUBSCRIPTION_TTL = 24 * 60 * 60; // 24 hours


  socket.on('chat:subscribe_status', async () => {
    await redis.sadd(STATUS_SUBSCRIBERS_KEY, socketId);
    await redis.expire(STATUS_SUBSCRIBERS_KEY, SUBSCRIPTION_TTL);
    console.log(`Socket ${socketId} subscribed to status updates`);
  });
  
  socket.on('chat:unsubscribe_status', async () => {
    await redis.srem(STATUS_SUBSCRIBERS_KEY, socketId);
    console.log(`Socket ${socketId} unsubscribed from status updates`);
  });

  const sendStatusUpdate = async (targetSocketId: string, messageId: string, status: string) => {
    const isSubscribed = await redis.sismember(STATUS_SUBSCRIBERS_KEY, targetSocketId);    
    if (isSubscribed) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        console.log(`Sending chat:status update to socket ${targetSocketId} for message ${messageId}: ${status}`);

        if (targetSocket.data && targetSocket.data.encryptionReady) {
          console.log(`Using encrypted binary format for chat:status to ${targetSocketId}`);
         targetSocket.emit('chat:status', { messageId, status });
        } else {
          console.log(`Using unencrypted format for chat:status to ${targetSocketId}`);
          targetSocket.emit('chat:status', { messageId, status });
        }

        //targetSocket.emit('chat:status', { messageId, status });

        //targetSocket.emit('chat:status', { messageId, status });
      } else {
        console.log(`[SendStatus] Target socket not found`);
      }
    } else {
      console.log(`[SendStatus] Target not subscribed to status updates`);
    }
  };
    

  const joinPrivateRoom = async (targetId: string): Promise<string> => {
    if (!clientId || !targetId) {
      throw new Error('Invalid client or target ID');
    }
  
    // Ensure IDs are different
    if (clientId === targetId) {
      throw new Error('Cannot create chat room with self');
    }

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

  const sendStatusCheckWithTimeout = async (recipientSocketId: string, messageData: ChatMessage): Promise<boolean> => {
    try {
      const targetSocket = io.sockets.sockets.get(recipientSocketId);
      if (!targetSocket) {
        console.log('Target socket not found for delivery confirmation');
        return false;
      }

      console.log(`Sending delivery confirmation request to ${recipientSocketId} for message ${messageData.messageId}`);
  
      // Use Socket.IO's timeout feature on the socket instance
      return new Promise<boolean>((resolve) => {
        targetSocket.timeout(2000).emit('chat:status', {
          messageId: messageData.messageId,
          status: 'confirm_delivery',
          fromId: messageData.fromId
        },
     //(response: { received: boolean } | Error) => {
        //  if (response instanceof Error) {
         //   console.log(`Delivery confirmation timeout for ${messageData.messageId}:`, response.message);
         //   resolve(false);
         // } else {
         //   console.log(`Delivery confirmation response for ${messageData.messageId}:`, response);
         //   resolve(response?.received || false);
        //  }
       // }
     // );
    // });
    (error: Error | null) => {
      if (error) {
        console.log(`Delivery confirmation timeout for ${messageData.messageId}:`, error.message);
        resolve(false);
      } else {
        // Just acknowledge the emit went through, actual confirmation comes via event
        resolve(true);
      }
    });
  });
  } catch (error) {
    console.error('Error in sendStatusCheckWithTimeout:', error);
    return false;
  }
};

  // Handle private message
  socket.on('chat:private', async (rawData: any, callback?: (response: { 
    success: boolean; 
    messageId?: string; 
    error?: string 
  }) => void) => {
    try {
      const data = rawData.data ? rawData.data : rawData;
      const { targetId, message, metaData, toData } = data;

      console.log('Received chat:private data:', {
        targetId,
        fromId: clientId,
        metaData,
        toData
      });

      const roomId = await joinPrivateRoom(targetId);
      const safeRoomId = roomId || [clientId, targetId].sort().join('_');

      const messageData: ChatMessage = {
        messageId: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        roomId: safeRoomId,
        message,
        fromId: clientId,
        timestamp: new Date().toISOString(),
        metaData,
        toData
      };

      await messageStore.saveMessage(apiKey, messageData);

      // Acknowledge message receipt to sender immediately
      //if (callback) {
       // callback({ 
       //   success: true, 
       //   messageId: messageData.messageId,
      //  });
      //}

      socket.emit('chat:status', {
        messageId: messageData.messageId,
        status: 'server_received',
        success: true
      });

      socket.emit('chat:message', messageData); //Always send the message to the sender

      sendStatusUpdate(socketId, messageData.messageId, 'sent');

      const recipientSocketsKey = `${apiKey}:${CLIENT_SOCKETS_PREFIX}${targetId}`;
      const recipientSockets = await redis.smembers(recipientSocketsKey);


      if (recipientSockets.length > 0) {
        for (const recipientSocketId of recipientSockets) {
          const recipientSocket = io.sockets.sockets.get(recipientSocketId);

          if (recipientSocket) {
            recipientSocket.emit('chat:message', messageData);

              console.log(`Requesting delivery confirmation for message ${messageData.messageId} from socket ${recipientSocketId}`);
              const received = await sendStatusCheckWithTimeout(recipientSocketId, messageData) //io.timeout(2000).to(recipientSocketId).emitWithAck('chat:status', {
                //messageId: messageData.messageId,
                //status: 'confirm_delivery',
              //});
              if (received) {
                console.log(`Message ${messageData.messageId} confirmed delivered to ${recipientSocketId}`);
                sendStatusUpdate(socketId, messageData.messageId, 'delivered');
              } else {
                console.log(`No delivery confirmation from ${recipientSocketId} for message ${messageData.messageId}`);
            }
          }
        }
      }
      //sendStatusUpdate(socketId, messageData.messageId, 'delivered');
    } catch (error) {
      console.error('Error handling private message:', error);
      socket.emit('chat:error', { message: 'Failed to send message' });
      socket.emit('chat:status', {
        status: 'server_received',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send message'
      });
      //if (callback){
        //callback({ 
        //  success: false,
       //   error: error instanceof Error ? error.message : 'Failed to send message'
       // });
      //}
    }
  });

  socket.on('chat:status', async (
    rawData: any,
    callback?: (response: { received: boolean }) => void
  ) => {
    try {
      const data = rawData.data ? rawData.data : rawData;
      const { messageId, status, fromId } = data;

      console.log(`Status: Received status update from ${clientId}:`, {
        messageId,
        status,
        fromId
      });
      // If this is a receipt confirmation request, acknowledge it
      if (status === 'delivered_confirmed' && fromId) {
        console.log('Confirming delivery for:', messageId);

          const senderSocketsKey = `${apiKey}:${CLIENT_SOCKETS_PREFIX}${fromId}`;
          const senderSockets = await redis.smembers(senderSocketsKey);

          console.log(`Found ${senderSockets.length} sender sockets for ${fromId}`);

            for (const senderSocketId of senderSockets) {
              const senderSocket = io.sockets.sockets.get(senderSocketId);
              console.log(`Attempting to send status update to sender socket ${senderSocketId}`);
              await sendStatusUpdate(senderSocketId, messageId, 'delivered');
            }
        } 
        //callback({ received: true });
      } catch (callbackError) {
        console.error('Error sending callback response:', callbackError);
      }
  });


  socket.on('chat:conversations', async(
    rawData: any
  ) => {
    try {
      const { limit =  50, offset = 0, requestId } = rawData.data ? rawData.data : rawData;

      console.log(`Fetching conversations for client ${clientId} with apiKey ${apiKey}`);

      const conversations = await messageStore.getRecentConversations(
        apiKey,
        clientId,
        limit
      );

      console.log(`Found ${conversations.length} conversations for user ${clientId}`);

      const responseData = {
        success: true,
        conversations: conversations.length ? conversations.slice(offset, offset + limit) : [],
        hasMore: conversations.length > offset + limit
      };

    console.log(`Sending chat:conversations response to client ${clientId}`);


    const paginatedConversations = conversations.slice(offset, offset + limit);
    const hasMore = conversations.length > offset + limit;

    socket.emit('chat:conversations_response', {
      requestId,
      success: true,
      conversations: paginatedConversations,
      hasMore
    });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    socket.emit('chat:conversations_response', {
      //requestId,
      success: false,
      error: 'Failed to fetch conversations'
    });
  }
  });

{/*  socket.on('chat:messages', async (
    options: { 
      roomId: string; 
      limit?: number;
      before?: string;
      after?: string;
    },
    callback?: (response: {
      success: boolean;
      messages?: ChatMessage[];
      error?: string;
    }) => void
  ) => {
    try {
      const { roomId, limit = 50, before = null, after = null } = options;

      if (!roomId.includes(clientId)) {
        if(callback) {
          callback({
            success: false,
            error: 'Unauthorized access to room'
          });
        }
        return;
      }

    const messages = await messageStore.getMessages(
      apiKey,
      roomId,
      {
        limit,
        before: before || undefined,
        after: after || undefined
      }
    );

    if (callback) {
      callback({
        success: true,
        messages
      });
    }
  } catch (error) {
    console.error('Error fetching messages:', error);
    if (callback) {
      callback({
        success: false,
        error: 'Failed to fetch messages'
      });
    }
  }
}); */}

  socket.on('chat:messages', async (
  rawData: any,
  callback?: (response: {
    success: boolean;
    messages?: ChatMessage[];
    error?: string;
  }) => void
) => {
  try {
    const options = rawData.data ? rawData.data : rawData;
    const { roomId, limit = 50, before = null, after = null, requestId } = options;

    console.log('Received chat:messages request:', {
      roomId,
      clientId,
      limit,
      before,
      after
    });

    // Validate required parameters
    if (!roomId || !clientId) {
      socket.emit('chat:messages_response', {
        requestId,
        success: false,
        error: 'Invalid room or client ID'
      })
      return;
    }

    // Check if client is authorized for this room
    if (!roomId.split('_').includes(clientId)) {
      socket.emit('chat:messages_response', {
        requestId,
        success: false,
        error: 'Unauthorized access to room'
      });
      //if (callback) {
        //callback({
          //success: false,
         // error: 'Unauthorized access to room'
        //});
      //}
      return;
    }

    const messages = await messageStore.getMessages(
      apiKey,
      roomId,
      {
        limit,
        before: before || undefined,
        after: after || undefined
      }
    );

    socket.emit('chat:messages_response', {
      requestId,
      success: true,
      messages
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    socket.emit('chat:messages_response', {
      //requestId,
      success: false,
      error: 'Failed to fetch messages'
    });
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
      //statusSubscribers.delete(socketId);
      await redis.srem(STATUS_SUBSCRIBERS_KEY, socketId);
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