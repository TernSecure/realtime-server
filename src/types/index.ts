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