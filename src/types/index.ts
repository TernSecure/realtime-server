import { Socket } from 'socket.io';

export interface ClientInfo {
  clientId: string;
  apiKey: string;
}

export interface ClientMetaData {
  name?: string;
  avatar?: string;
  email?: string;
}

export interface SocketData {
  clientId: string;
  apiKey: string;
  socketId: string;
  sessionId: string;
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
  messageId: string;
  roomId: string;
  message: string;
  fromId: string;
  toId?: string;
  timestamp: string;
  metaData?: ClientMetaData;
  toData?: ClientMetaData;
}


//events server sends to client
export interface ServerToClientEvents {
  'presence:enter': (data: { clientId: string; status: string }) => void;
  'presence:update': (data: { clientId: string; status: string }) => void;
  'presence:sync': (data: { [clientId: string]: { status: string; lastSeen: Date } }) => void;
  'presence:leave': (data: { clientId: string }) => void;
  
  'chat:message': (message: ChatMessage) => void;
  'chat:error': (error: { message: string }) => void;
  //'chat:delivered': (data: { messageId: string }) => void;
  'chat:profile_updated': () => void;
  'chat:typing': (data: { fromId: string; isTyping: boolean }) => void;
  'chat:status': (data: { messageId: string; status: string }) => void
  //'chat:confirm_receipt': (data: { messageId: string }, callback: (response: { received: boolean }) => void) => void;
  
  'session': (data: { sessionId: string }) => void;
}

//events client sends to server
export interface ClientToServerEvents {
  'chat:private': (data: { targetId: string; message: string }) => void;
  'chat:typing': (data: { targetId: string; isTyping: boolean }) => void;
  'chat:profile_update': (data: ClientMetaData) => void;
  //'chat:confirm_receipt': (data: { messageId: string }) => { received: boolean };
  'chat:status': (data: { messageId: string; status: string }, callback?: (response: { received: boolean }) => void) => void; // New unified status event
  'chat:subscribe_status': () => void;
  'chat:unsubscribe_status': () => void; 
  
  'presence:update': (status: string) => void;
}

export interface InterServerEvents {
  // Define events between servers (if any)
  ping: () => void;
}

export type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface Session {
  sessionId: string;
  clientId: string;
  connected: boolean;
  lastActive: number;
  userAgent?: string;
  ip?: string;
  socketIds: string[];
}

export interface SessionStore {
  findSession(sessionId: string): Promise<Session | null>;
  findSessionByClientId(clientId: string): Promise<Session | null>;
  saveSession(session: Session): Promise<void>;
  createSession(session: Session): Promise<Session>;
  updateConnectionStatus(sessionId: string, socketId: string, connected: boolean): Promise<void>;
  removeSocket(sessionId: string, socketId: string): Promise<boolean>;
}


export const SOCKET_MAP_PREFIX = 'socket:map:';
export const CLIENT_SOCKETS_PREFIX = 'client:sockets:';
export const API_KEY_CLIENTS_PREFIX = 'apikey:clients:';
export const OFFLINE_MESSAGES_PREFIX = 'offline:messages:';
export const CHAT_ROOMS_PREFIX = 'chat:rooms:';
export const CLIENT_ADDITIONAL_DATA_PREFIX = 'client:data:';
export const SESSION_PREFIX = 'socket:session:';
export const CLIENT_SESSION_PREFIX = 'socket:client:';
export const MESSAGES_PREFIX = 'messages:';
export const MESSAGE_ID_PREFIX = 'message:id:';
export const ROOM_MESSAGES_PREFIX = 'room:messages:';