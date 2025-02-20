import { Server } from 'socket.io';
import { createServer } from 'http';
import express from 'express';
import  { instrument } from '@socket.io/admin-ui';
import { networkInterfaces } from 'os';
import { Redis } from 'ioredis';
import { createAdapter } from "@socket.io/redis-adapter";

const app = express();
const httpServer = createServer(app);
const redis = new Redis();
const redisSub = redis.duplicate();


app.use(express.json());

const io = new Server(httpServer, {
  adapter: createAdapter(redis, redisSub),
  transports: ['websocket', 'polling'],
  cors: {
    origin: [
      "http://localhost:3000", 
      "http://10.162.0.6",
      "https://realtime-admin.ternsecure.com",
    ],
    credentials: true
  },
});


// Debug middleware to log raw request
app.use((req, res, next) => {
  console.log('Request Headers:', req.headers);
  console.log('Request Body:', req.body);
  next();
});

instrument(io, {
  auth: false,
  mode: "development",
});

// Track active rooms
const NOTIFICATION_ROOM = 'notifications';
const clientSockets = new Map();
const socketToClient = new Map();
const keyToClients = new Map();
const userPresence = new Map(); 
const roomMembers = new Map(); 
const clientRooms = new Map();
const clientPresence = new Map();

//const HEARTBEAT_INTERVAL = 30000;
//const PRESENCE_TIMEOUT = 60000;

// Utility function to mask sensitive data
const maskSensitive = (text, showLength = 4) => {
  if (!text) return '';
  const visiblePart = text.slice(0, showLength);
  return `${visiblePart}${'*'.repeat(text.length - showLength)}`;
}

// Middleware to validate connection credentials
io.use((socket, next) => {
  const { clientId, apiKey } = socket.handshake.auth;

  if (!clientId || !apiKey) {
    console.log('Connection rejected: Missing credentials');
    return next(new Error('Authentication failed: Missing clientId or apiKey'));
  }

  // Store client info in socket for later use
  socket.clientId = clientId;
  socket.apiKey = apiKey;

  console.log(`Authentication successful for client ${maskSensitive(clientId)}`);
  console.log(`Using API key: ${maskSensitive(apiKey)}`);
  next();
});


io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  const { clientId, apiKey } = socket;

      const existingSockets = clientSockets.get(clientId) || [];
      clientSockets.set(clientId, [...existingSockets, socket.id]);

      socketToClient.set(socket.id, { clientId, apiKey });

      const existingClients = keyToClients.get(apiKey) || [];
      if (!existingClients.includes(clientId)) {
        keyToClients.set(apiKey, [...existingClients, clientId]);
      }

      socket.join(`key:${apiKey}`);

      // Handle member enter
      const enterPresence = () => {
        console.log(`Initializing presence for client ${clientId} with socket ${socket.id}`);
        const presence = {
          status: 'online',
          customMessage: '',
          lastUpdated: new Date().toISOString(),
          //lastHeartbeat: Date.now(),
          socketId: socket.id
        };
        
        clientPresence.set(clientId, presence);

        const existingMembers = Array.from(clientPresence.entries())
        .map(([clientId, presence]) => ({ 
          clientId, 
          presence 
        }));

        socket.emit('presence:sync', existingMembers);
    
        // Emit enter event
        socket.broadcast.to(`key:${apiKey}`).emit('presence:enter', {
          clientId,
          presence
        });
    
        // Send existing members to new client
        //const existingMembers = Array.from(clientPresence.entries())
        //  .filter(([id]) => id !== clientId)
        //  .map(([clientId, presence]) => ({ clientId, presence }));
      };

      // Handle presence update
      socket.on('presence:update', ({ status, customMessage }) => {
        const presence = {
          status,
          customMessage,
          lastUpdated: new Date().toISOString(),
          socketId: socket.id
        };

        clientPresence.set(clientId, presence);
    
        socket.broadcast.to(`key:${apiKey}`).emit('presence:update', {
          clientId,
          presence
        });

        // Emit to ALL clients in the room INCLUDING sender
        io.to(`key:${apiKey}`).emit('presence:update', {clientId, presence});
        // Or alternatively:
        // socket.broadcast.to(`key:${apiKey}`).emit('presence:update', presenceUpdate);
        // socket.emit('presence:update', presenceUpdate); // Send to sender
      });

      socket.on('presence:heartbeat', () => {
        const presence = clientPresence.get(clientId);
        if (presence) {
          presence.lastHeartbeat = Date.now();
          presence.lastUpdated = new Date().toISOString();
        }
      });


      console.log(`Client ${clientId} registered with key ${apiKey}`);
      console.log(`Clients sharing key ${apiKey}:`, Array.from(keyToClients.get(apiKey)));


  // Create or join a private chat (1:1)
  socket.on("create_private_chat", async ({ targetClientId }) => {
    try {
      const clientInfo = socketToClient.get(socket.id);
      if (!clientInfo) throw new Error('Client not registered');
      const { clientId, apiKey } = clientInfo;

      // Validate both clients belong to same tenant
      const tenantClients = keyToClients.get(apiKey) || [];
      if (!tenantClients.includes(targetClientId)) {
        throw new Error('Target client not found in tenant');
      }

      // Create unique room ID for 1:1 chat (sorted to ensure same ID regardless of order)
      const participants = [clientId, targetClientId].sort();
      const roomId = `private:${apiKey}:${participants.join('_')}`;

      // Join room
      await socket.join(roomId);
      
      // Track room membership
      if (!roomMembers.has(roomId)) {
        roomMembers.set(roomId, participants);
      }

      // Track client's rooms
      for (const participant of participants) {
        const rooms = clientRooms.get(participant) || [];
        if (!rooms.includes(roomId)) {
          clientRooms.set(participant, [...rooms, roomId]);
        }
      }

      socket.emit('private_chat_created', { roomId, participants });

    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Create group chat
  socket.on("create_group_chat", async ({ name, members }) => {
    try {
      const clientInfo = socketToClient.get(socket.id);
      if (!clientInfo) throw new Error('Client not registered');
      const { clientId, apiKey } = clientInfo;

      // Validate all members belong to same tenant
      const tenantClients = keyToClients.get(apiKey) || [];
      const invalidMembers = members.filter(m => !tenantClients.includes(m));
      if (invalidMembers.length > 0) {
        throw new Error('Some members not found in tenant');
      }

      // Create unique room ID for group
      const roomId = `group:${apiKey}:${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Join room
      await socket.join(roomId);
      
      // Track room membership
      const allMembers = [...new Set([clientId, ...members])];
      roomMembers.set(roomId, {
        name,
        members: allMembers,
        createdBy: clientId,
        createdAt: new Date()
      });

      // Track client's rooms
      for (const member of allMembers) {
        const rooms = clientRooms.get(member) || [];
        clientRooms.set(member, [...rooms, roomId]);
        
        // Notify online members to join room
        const memberSockets = clientSockets.get(member) || [];
        for (const socketId of memberSockets) {
          io.sockets.sockets.get(socketId)?.join(roomId);
        }
      }

      io.to(roomId).emit('group_chat_created', {
        roomId,
        name,
        members: allMembers
      });

    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Get user's rooms
  socket.on("get_rooms", async () => {
    try {
      const clientInfo = socketToClient.get(socket.id);
      if (!clientInfo) throw new Error('Client not registered');
      const { clientId, apiKey } = clientInfo;

      const rooms = clientRooms.get(clientId) || [];
      const roomDetails = rooms.map(roomId => ({
        roomId,
        type: roomId.startsWith('private:') ? 'private' : 'group',
        members: roomMembers.get(roomId),
        // For group chats, include additional info
        ...(roomId.startsWith('group:') && {
          name: roomMembers.get(roomId).name,
          createdBy: roomMembers.get(roomId).createdBy
        })
      }));

      socket.emit('rooms_list', roomDetails);

    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Send message to room
  socket.on("send_message", async ({ roomId, message }) => {
    try {
      const clientInfo = socketToClient.get(socket.id);
      if (!clientInfo) throw new Error('Client not registered');
      const { clientId, apiKey } = clientInfo;

      // Validate room belongs to tenant
      if (!roomId.includes(apiKey)) {
        throw new Error('Room not found');
      }

      // Validate sender is room member
      const members = roomMembers.get(roomId);
      if (!members?.includes(clientId)) {
        throw new Error('Not a member of this room');
      }

      // Broadcast message to room
      io.to(roomId).emit('new_message', {
        roomId,
        message,
        senderId: clientId,
        timestamp: new Date()
      });

    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on("set_presence", ({ status, customMessage }) => {
    const clientInfo = socketToClient.get(socket.id);
    if (!clientInfo) return;

    const { clientId, apiKey } = clientInfo;
    
    // Update presence information
    clientPresence.set(clientId, {
      status,           
      customMessage, 
      lastUpdated: new Date(),
      socketId: socket.id
    });

    const presenceUpdates = Array.from(clientPresence.entries())
    .filter(([_, presence]) => presence.socketId) // Only active connections
    .map(([clientId, presence]) => ({
      clientId,  // Changed from clientId to match interface
      presence
    }));

    // Broadcast to room members only if status changed
    io.to(`key:${apiKey}`).emit('presence_updated', presenceUpdates)
  });

  // Get presence information for room members , manually pull
  socket.on("get_presence", async () => {
    const clientInfo = socketToClient.get(socket.id);
    if (!clientInfo) return;

    const { apiKey } = clientInfo;
    const roomClients = keyToClients.get(apiKey) || [];
    
    // Get presence info for all room members
    const presenceInfo = {};
    for (const clientId of roomClients) {
      presenceInfo[clientId] = userPresence.get(clientId) || { status: 'offline' };
    }

    socket.emit('presence_info', presenceInfo);
  });

    // Optional: Handle client explicitly leaving
  socket.on('unregister_client', () => {
    const clientInfo = socketToClient.get(socket.id);
    if (clientInfo) {
      const { clientId, apiKey } = clientInfo;
      
      // Remove socket from clientSockets
      const sockets = clientSockets.get(clientId) || [];
      const updatedSockets = sockets.filter(id => id !== socket.id);
      
      if (updatedSockets.length === 0) {
        clientSockets.delete(clientId);
        
        // Remove from keyToClients
        const clients = keyToClients.get(apiKey) || [];
        const updatedClients = clients.filter(id => id !== clientId);
        
        if (updatedClients.length === 0) {
          keyToClients.delete(apiKey);
        } else {
          keyToClients.set(apiKey, updatedClients);
        }
      } else {
        clientSockets.set(clientId, updatedSockets);
      }
      
      socketToClient.delete(socket.id);
      socket.leave(`key:${apiKey}`);
    }
  });
  
    // Join specific notification channels/rooms
  socket.on('join', async (room) => {
    try {
      if(room === NOTIFICATION_ROOM) {
        await socket.join(NOTIFICATION_ROOM);
        console.log(`Client ${socket.id} joined room: ${NOTIFICATION_ROOM}`);

      const notifications = await redis.lrange(
        `notifications:${NOTIFICATION_ROOM}`, 
        0, 
        99
      );

      console.log('Sending recent notifications:', notifications.length);

      socket.emit('recent_notifications', {
        notifications: notifications.map(n => JSON.parse(n))
      });
    }
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

    // Leave notification channels/rooms
  socket.on('leave', (room) => {
    if (room === NOTIFICATION_ROOM) {
      socket.leave(NOTIFICATION_ROOM);
      console.log(`Client ${socket.id} left ${NOTIFICATION_ROOM}`);
    }
  });

  socket.on("disconnecting", (reason) => {
    console.log(`Client ${clientId} disconnecting:`, reason);
    // We can access rooms before they're left
    const rooms = Array.from(socket.rooms);
    console.log('Rooms being left:', rooms);
    
    // Can be useful for room-specific notifications
    rooms.forEach(room => {
      if (room !== socket.id) { // socket.id is always a room
        socket.to(room).emit('user_left_room', {
          clientId,
          room
        });
      }
    });
  });

  socket.on("disconnect", (reason) => {
      console.log(`Client ${clientId} disconnected:`, reason);

      const sockets = clientSockets.get(clientId) || [];
      const updatedSockets = sockets.filter(id => id !== socket.id);

      if (updatedSockets.length === 0) {
        clientSockets.delete(clientId);

        clientPresence.delete(clientId);

        io.to(`key:${apiKey}`).emit('presence:leave', {
          clientId
      });

        const clients = keyToClients.get(apiKey) || [];
        const updatedClients = clients.filter(id => id !== clientId);

        if (updatedClients.length === 0) {
          keyToClients.delete(apiKey);
        } else {
          keyToClients.set(apiKey, updatedClients);
        }
      } else {
        clientSockets.set(clientId, updatedSockets);
      }

      socketToClient.delete(socket.id);

      socket.leave(`key:${apiKey}`);
      console.log('Cleanup completed for client:', clientId);
  });

  socket.on("error", (error) => {
    console.error("Socket error:", error);
  });

  enterPresence();
});

// hearbeat function will be called when needed
{/*function startPresenceCleanup() {
  console.log('Starting presence cleanup interval');
  return setInterval(() => {
    const now = Date.now();
    for (const [clientId, presence] of clientPresence.entries()) {
      // Only cleanup if last heartbeat is really old (2x timeout)
      if (now - presence.lastHeartbeat > PRESENCE_TIMEOUT * 2) {
        console.log(`CleanupInterval: Client ${clientId} timed out (Last heartbeat: ${new Date(presence.lastHeartbeat).toISOString()})`);
        clientPresence.delete(clientId);
        io.emit('presence:leave', { clientId });
      }
    }
  }, PRESENCE_TIMEOUT);
}*/}

//const cleanupInterval = startPresenceCleanup();


// REST API endpoints
app.get('/api/status', (req, res) => {
  res.json({ status: 'Server is running' });
});


app.post('/api/notifications', async (req, res) => {
  try {
    const { type, message, data = {} } = req.body;
        
    if (!type || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Type and message are required fields' 
      });
    }

    const notification = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      message,
      data,
      createdAt: new Date().toISOString()
    };

    console.log('Creating new notification:', notification);

    // Store in room-specific list
    //await redis.lpush(`notifications:${NOTIFICATION_ROOM}`, JSON.stringify(notification));
    //await redis.ltrim(`notifications:${NOTIFICATION_ROOM}`, 0, 99);
      

    io.to(NOTIFICATION_ROOM).emit('notification', notification);
    console.log('Broadcasted notification to room:', NOTIFICATION_ROOM);
    
    res.json({
      success: true,
      data: { notification }
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create notification',
      details: error.message
    });
  }
});

// Get notifications endpoint
app.get('/api/notifications', async (req, res) => {
  try {
    const { offset = 0, limit = 10 } = req.query;

    // Get notifications for the room
    const notifications = await redis.lrange(
      `notifications:${NOTIFICATION_ROOM}`, 
      parseInt(offset), 
      parseInt(offset) + parseInt(limit) - 1
    );

    const totalCount = await redis.llen(`notifications:${NOTIFICATION_ROOM}`);

    res.json({
      success: true,
      data: {
        notifications: notifications.map(n => JSON.parse(n)),
        pagination: {
          total: totalCount,
          offset: parseInt(offset),
          limit: parseInt(limit),
          hasMore: totalCount > (parseInt(offset) + parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notifications',
      details: error.message
    });
  }
});



const PORT = 3000;
httpServer.listen(PORT, () => {
  // Get network interfaces
  
  const nets = networkInterfaces();
  const results = {};

  // Collect all IP addresses
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip internal (i.e. 127.0.0.1) and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        if (!results[name]) {
          results[name] = [];
        }
        results[name].push(net.address);
      }
    }
  }

  console.log('Server IP addresses:');
  Object.keys(results).forEach(iface => {
    console.log(`${iface}: ${results[iface].join(', ')}`);
  });
  console.log(`TernSecure WebSocket server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  //clearInterval(cleanupInterval);
  console.log('SIGTERM received. Closing server...');
  httpServer.close(() => {
    redis.quit();
    redisSub.quit();
    console.log('Server closed');
    process.exit(0);
  });
});
