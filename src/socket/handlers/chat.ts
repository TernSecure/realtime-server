import { Server, Socket } from 'socket.io';
import { SocketState } from '../state';
import type { ChatMessage } from '../../types'


export const handleChat = (io: Server, socket: Socket, state: SocketState) => {
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
        socket.emit('chat:error', { message: 'Cannot chat with user from different API key' });
        return;
      }

      const messageData: ChatMessage = {
        roomId,
        message,
        senderId: clientId,
        timestamp: new Date(),
        apiKey
      };


      io.to(roomId).emit('chat:message', messageData);

    } catch (error) {
      console.error('Error handling private message:', error);
      socket.emit('chat:error', { message: 'Failed to send message' });
    }
  });

  // Handle typing indicator within same API key
  socket.on('chat:typing', ({ targetId, isTyping }: { targetId: string; isTyping: boolean }) => {
    const roomId = joinPrivateRoom(targetId);
    if (roomId) {
      socket.to(roomId).emit('chat:typing', { clientId, isTyping });
    }
  });

  return {
    cleanup: () => {
      socket.rooms.forEach(room => socket.leave(room));
    }
  };
};
