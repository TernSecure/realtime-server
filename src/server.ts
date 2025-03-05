import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import express = require('express'); 
import { instrument } from '@socket.io/admin-ui';
import { Redis } from 'ioredis';
import { createAdapter } from "@socket.io/redis-adapter";
import { createSessionStore } from './socket/';
import { 
  socketMiddleware,
  handlePresence,
  handleChat,
  handleConnection,
  logNetworkAddresses
} from './socket/';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  SocketData,
  TypedSocket,
} from './types'



interface ServerConfig {
  adapter: ReturnType<typeof createAdapter>;
  transports: ('websocket' | 'polling')[];
  cors: {
    origin: string[];
    credentials: boolean;
  };
  connectionStateRecovery: {
    maxDisconnectionDuration: number;
  };
}

const app = express();
const httpServer = createServer(app);
const redisPub = new Redis();
const redisSub = redisPub.duplicate();
//const state = new SocketState();

app.use(express.json());

const serverConfig: ServerConfig = {
  adapter: createAdapter(redisPub, redisSub),
  transports: ['websocket', 'polling'],
  cors: {
    origin: [
      "http://localhost:3000", 
      "http://10.162.0.6",
      "https://realtime-admin.ternsecure.com",
    ],
    credentials: true
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
  }
};

const sessionStore = createSessionStore({
  type: 'redis',
  redis: redisPub
});


const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData
>(httpServer, serverConfig);


instrument(io, {
  auth: false,
  mode: "development",
});

//const HEARTBEAT_INTERVAL = 30000;
//const PRESENCE_TIMEOUT = 60000;

io.use(socketMiddleware(sessionStore));


io.on("connection", (socket: Socket<TypedSocket>) => {
  console.log("Client connected:", socket.id);
  if(socket.recovered) {

  }

  const connectionHandler = handleConnection(io, socket, redisPub);
  const presenceHandler = handlePresence(io, socket, redisPub);
  const chatHandler = handleChat(io, socket, redisPub);

  
  presenceHandler.enterPresence();

  socket.on('disconnect', async (reason) => {
    console.log('Client disconnected:', socket.id, reason);
    
    const { isLastSocket, leaveRoom } = await connectionHandler.cleanup();
    
    await Promise.all([
      presenceHandler.cleanup(isLastSocket),
      chatHandler.cleanup()
    ]);

    leaveRoom();
  });
});


const PORT = 3000;
httpServer.listen(PORT, () => {
  logNetworkAddresses(PORT);
});

process.on('SIGTERM', () => {
  //clearInterval(cleanupInterval);
  console.log('SIGTERM received. Closing server...');
  httpServer.close(() => {
    redisPub.quit();
    redisSub.quit();
    console.log('Server closed');
    process.exit(0);
  });
});
