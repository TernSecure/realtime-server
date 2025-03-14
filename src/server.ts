import { Server, Socket } from 'socket.io';
import { createServer } from 'http';
import express = require('express'); 
import { instrument } from '@socket.io/admin-ui';
import { Redis } from 'ioredis';
import { createAdapter } from "@socket.io/redis-adapter";
import { createSessionStore } from './socket/';
import { 
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
import { socketMiddleware, initializeEncryption} from './middleware';
//import { setupAuthRoutes } from './routes';
import { setupAuthRoutes } from './api/auth';
import dotenv from 'dotenv';

dotenv.config();


const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';


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
  pingTimeout: number;
  pingInterval: number;
  connectTimeout: number;
}

const app = express();
const httpServer = createServer(app);
const redisPub = new Redis(redisUrl);
const redisSub = redisPub.duplicate();
//const state = new SocketState();

const sessionStore = createSessionStore({
  type: 'redis',
  redis: redisPub
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', (req, res, next) => {
  console.log(`API Request: ${req.method} ${req.url}`);
  next();
});

app.use('/api/auth', setupAuthRoutes(sessionStore));

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Add 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

const serverConfig: ServerConfig = {
  adapter: createAdapter(redisPub, redisSub),
  transports: ['websocket', 'polling'],
  cors: {
    origin: [
      "http://localhost:3000",
      "http://10.162.0.6",
      "https://realtime-admin.ternsecure.com",
      "https://auth-test-one-chi.vercel.app"
    ],
    credentials: true
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 10000
};


initializeEncryption(sessionStore);

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

  const connectionHandler = handleConnection(io, socket, redisPub, sessionStore);
  const presenceHandler = handlePresence(io, socket, redisPub);
  const chatHandler = handleChat(io, socket, redisPub);

  
  presenceHandler.enterPresence();

  socket.onAny((event) => {
    if (socket.listeners(event).length === 0) {
      console.log(`missing handler for event ${event}`);
    }
  });


  socket.on('disconnect', async (reason) => {
    console.log('Client disconnected:', socket.id, reason);
    const session = await sessionStore.findSession(socket.data.sessionId);

    if ((reason === 'transport close' || reason === 'ping timeout') && session) {
      await sessionStore.updateConnectionStatus(socket.data.sessionId, socket.id, false);

      setTimeout(async () => {
        try {
          const updatedSession = await sessionStore.findSession(socket.data.sessionId);
          const hasReconnected = updatedSession?.socketIds && updatedSession.socketIds.length > 0;

          if (!updatedSession || (!updatedSession.connected && !hasReconnected)) {
            console.log(`No reconnection detected for session ${socket.data.sessionId}, performing cleanup`);
            const { isLastSocket, leaveRoom } = await connectionHandler.cleanup();

            await Promise.all([
              presenceHandler.cleanup(isLastSocket),
              chatHandler.cleanup()
            ]);

            leaveRoom();
          } else {
            console.log(
              `Session ${socket.data.sessionId} has reconnected with ${
                updatedSession.socketIds?.length || 0
              } active sockets`
            );
          }
        } catch (error) {
          console.error('Error checking session reconnection:', error);
        }
      }, 30000);
    } else {
    
    const { isLastSocket, leaveRoom } = await connectionHandler.cleanup();
    
    await Promise.all([
      presenceHandler.cleanup(isLastSocket),
      chatHandler.cleanup()
    ]);

    leaveRoom();
  }
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
