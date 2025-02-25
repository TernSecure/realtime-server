import { Server, Socket } from 'socket.io';
import { SocketState } from '../state';
import { Redis } from 'ioredis';
import type { ChatMessage } from '../../types'


export const handleChat = (
  io: Server,
  socket: Socket, 
  state: SocketState,
  redis: Redis
) => {
  const { clientId, apiKey } = socket.handshake.auth; 


  const joinPrivateRoom = (targetClientId: string): string | null => {

    const apiKeyClients = state.keyToClients.get(apiKey) || [];
    if (!apiKeyClients.includes(targetClientId)) {
      return null;  
    }

    const roomId = [clientId, targetClientId].sort().join('_');
    socket.join(roomId);
    return roomId;
  };

  // Handle private message
  socket.on('chat:private', async (data: { targetId: string; message: string }) => {
    try {
      const { targetId, message } = data;
      const roomId = joinPrivateRoom(targetId);

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

      const recipientSockets = state.clientSockets.get(targetId) || [];

      if(recipientSockets.length > 0) {
        io.to(roomId).emit('chat:message', messageData);
        socket.emit('chat:delivered', { messageId: messageData.messageId });
      } else {
        await redis.lpush(
          `offline_messages:${targetId}`,
          JSON.stringify(messageData)
        );
      }

    } catch (error) {
      console.error('Error handling private message:', error);
      socket.emit('chat:error', { message: 'Failed to send message' });
    }
  });

  // Handle typing indicator within same API key
  socket.on('chat:typing', ({ targetId, isTyping }: { targetId: string; isTyping: boolean }) => {
    const roomId = joinPrivateRoom(targetId);
    if (roomId) {
      socket.to(roomId).emit('chat:typing', {
        senderId: clientId, 
        isTyping 
      });
    }
  });

  const deliverOfflineMessages = async () => {
    const messages = await redis.lrange(`offline_messages:${clientId}`, 0, -1);
    if (messages.length > 0) {
      messages.forEach(msg => {
        const messageData = JSON.parse(msg);
        socket.emit('chat:message', messageData);
      });
      await redis.del(`offline_messages:${clientId}`);
    }
  };

  deliverOfflineMessages().catch(console.error);

  return {
    cleanup: () => {
      socket.rooms.forEach(room => socket.leave(room));
    }
  };
};
