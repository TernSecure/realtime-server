import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import express = require('express'); 
import { instrument } from '@socket.io/admin-ui';
import { Redis } from 'ioredis';
import { createAdapter } from "@socket.io/redis-adapter";
import { socketMiddleware, handlePresence, SocketState, handleConnection, logNetworkAddresses} from './socket/';
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
}

const app = express();
const httpServer = createServer(app);
const redis = new Redis();
const redisSub = redis.duplicate();
const state = new SocketState();

app.use(express.json());

const serverConfig: ServerConfig = {
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
};


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

io.use(socketMiddleware);


io.on("connection", (socket: Socket<TypedSocket>) => {
  console.log("Client connected:", socket.id);

  const connectionHandler = handleConnection(io, socket, state);
  const presenceHandler = handlePresence(io, socket, state.clientPresence);

  presenceHandler.enterPresence();

  socket.on('disconnecting', (reason) => {
    console.log(reason);
  });

  socket.on('disconnect', (reason) => {
    console.log('Client disconnected:', socket.id);
    connectionHandler.cleanup();
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
    redis.quit();
    redisSub.quit();
    console.log('Server closed');
    process.exit(0);
  });
});
