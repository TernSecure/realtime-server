import { Server, Socket } from 'socket.io';
import { SocketState } from '../state';

export const handleConnection = (
  io: Server,
  socket: Socket,
  state: SocketState
) => {
  const { clientId, apiKey } = socket.handshake.auth;

  // Track client sockets
  const existingSockets = state.clientSockets.get(clientId) || [];
  state.clientSockets.set(clientId, [...existingSockets, socket.id]);

  // Map socket to client info
  state.socketToClient.set(socket.id, { clientId, apiKey });

  // Group clients by API key
  const existingClients = state.keyToClients.get(apiKey) || [];
  if (!existingClients.includes(clientId)) {
    state.keyToClients.set(apiKey, [...existingClients, clientId]);
  }

  // Join API key room
  socket.join(`key:${apiKey}`);

  return {
    cleanup: () => {
      console.log(`Client ${clientId} disconnecting, cleaning up...`);
      
      const sockets = state.clientSockets.get(clientId) || [];
      const updatedSockets = sockets.filter(id => id !== socket.id);
      const isLastSocket = updatedSockets.length === 0;

      if (isLastSocket) {
        // Remove all client data if this was the last socket
        state.clientSockets.delete(clientId);

        state.clientPresence.delete(clientId);
        
        io.to(`key:${apiKey}`).emit('presence:leave', {
          clientId
        });

        const clients = state.keyToClients.get(apiKey) || [];
        const updatedClients = clients.filter(id => id !== clientId);

        if (updatedClients.length === 0) {
          state.keyToClients.delete(apiKey);
        } else {
          state.keyToClients.set(apiKey, updatedClients);
        }
      } else {
        // Update remaining sockets
        state.clientSockets.set(clientId, updatedSockets);
      }

      // Always clean up socket mapping
      state.socketToClient.delete(socket.id);
      socket.leave(`key:${apiKey}`);

      console.log('Cleanup completed for client:', clientId);
      return isLastSocket;
    }
  };
};