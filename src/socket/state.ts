import { ClientInfo, Presence, RoomMember } from '../types';

export class SocketState {
  public clientSockets: Map<string, string[]>;
  public socketToClient: Map<string, ClientInfo>;
  public keyToClients: Map<string, string[]>;
  public userPresence: Map<string, Presence>;
  public roomMembers: Map<string, RoomMember>;
  public clientRooms: Map<string, string[]>;
  public clientPresence: Map<string, Presence>;

  constructor() {
    this.clientPresence = new Map();
    this.roomMembers = new Map();
    this.clientSockets = new Map();
    this.socketToClient = new Map();
    this.keyToClients = new Map();
    this.userPresence = new Map();
    this.clientRooms = new Map();
  }
}