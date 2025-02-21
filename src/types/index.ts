import { Socket } from 'socket.io';

export interface ClientInfo {
  clientId: string;
  apiKey: string;
}

export interface Presence {
  status: string;
  customMessage: string;
  lastUpdated: string;
  socketId: string;
  lastHeartbeat?: number;
}

export interface RoomMember {
  name?: string;
  members: string[];
  createdBy?: string;
  createdAt?: Date;
}

export interface Notification {
  id: string;
  type: string;
  message: string;
  data: Record<string, any>;
  createdAt: string;
}

// Extend Socket type to include our custom properties
export interface CustomSocket extends Socket {
  clientId: string;
  apiKey: string;
}

export interface PresenceUpdate {
  clientId: string;
  presence: Presence;
}

export interface GroupChatDetails {
  roomId: string;
  name: string;
  members: string[];
}

export interface Message {
  roomId: string;
  message: string;
  senderId: string;
  timestamp: Date;
}

export interface ChatMessage {
  roomId: string;
  message: string;
  senderId: string;
  timestamp: Date;
  apiKey: string; 
}


//events server sends to client
export interface ServerToClientEvents {
  "presence:enter": (data: { clientId: string; status: string }) => void;
  "presence:update": (data: { clientId: string; status: string }) => void;
  "presence:sync": (data: { [clientId: string]: { status: string; lastSeen: Date } }) => void;
  "presence:leave": (data: { clientId: string }) => void;
  
  "chat:message": (data: ChatMessage) => void;
  "chat:error": (data: { message: string }) => void;
  "chat:typing": (data: { clientId: string; isTyping: boolean }) => void;
}

//events client sends to server
export interface ClientToServerEvents {
  "chat:private": (data: { targetId: string; message: string }) => void;
  "chat:typing": (data: { targetId: string; isTyping: boolean }) => void;
  
  "presence:update": (status: string) => void;
}

export interface InterServerEvents {
  // Define events between servers (if any)
  ping: () => void;
}

export interface SocketData {
  clientId: string;
  apiKey: string;
  socketId: string;
}

export type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;