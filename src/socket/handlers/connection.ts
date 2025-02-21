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
      state.clientSockets.delete(clientId);
      state.socketToClient.delete(socket.id);
    }
  };
};