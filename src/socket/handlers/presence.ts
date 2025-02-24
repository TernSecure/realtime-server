import { Server, Socket } from 'socket.io';
import { Presence } from '../../types';

export const handlePresence = (
  io: Server,
  socket: Socket,
  clientPresence: Map<string, Presence>
) => {
  const { clientId, apiKey } = socket.handshake.auth;

  const enterPresence = (): void => {
    console.log(`Initializing presence for client ${clientId} with socket ${socket.id}`);
    
    const presence: Presence = {
      status: 'online',
      customMessage: '',
      lastUpdated: new Date().toISOString(),
      socketId: socket.id
    };
    
    clientPresence.set(clientId, presence);

    const existingMembers = Array.from(clientPresence.entries())
      .map(([clientId, presence]) => ({ 
        clientId, 
        presence 
      }));

    socket.emit('presence:sync', existingMembers);

    io.to(`key:${apiKey}`).emit('presence:enter', {
      clientId,
      presence
    });
  };

  const cleanup = (isLastSocket: boolean): void => {
    if (isLastSocket) {
      clientPresence.delete(clientId);
      io.to(`key:${apiKey}`).emit('presence:leave', {
        clientId
      });
    }
  };

  socket.on('presence:update', ({ status, customMessage }: { status: string; customMessage: string }) => {
    const presence: Presence = {
      status,
      customMessage,
      lastUpdated: new Date().toISOString(),
      socketId: socket.id
    };

    clientPresence.set(clientId, presence);

    io.to(`key:${apiKey}`).emit('presence:update', { clientId, presence });
  });

  socket.on('presence:heartbeat', () => {
    const presence = clientPresence.get(clientId);
    if (presence) {
      presence.lastHeartbeat = Date.now();
      presence.lastUpdated = new Date().toISOString();
    }
  });


  return {
    enterPresence,
    cleanup
  };
};