import { Server } from 'socket.io';
import { createServer } from 'http';
import express = require('express'); 
import { instrument } from '@socket.io/admin-ui';
import { networkInterfaces } from 'os';
import { Redis } from 'ioredis';
import { createAdapter } from "@socket.io/redis-adapter";
import { socketMiddleware, handlePresence, SocketState } from './socket/';

const app = express();
const httpServer = createServer(app);
const redis = new Redis();
const redisSub = redis.duplicate();
const state = new SocketState();


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


instrument(io, {
  auth: false,
  mode: "development",
});

//const HEARTBEAT_INTERVAL = 30000;
//const PRESENCE_TIMEOUT = 60000;

io.use(socketMiddleware);



io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  const presenceHandler = handlePresence(io, socket, state.clientPresence);

  presenceHandler.enterPresence();

  socket.on('disconnecting', (reason) => {

    //todo
  });

  socket.on('disconnect', (reason) => {
    //todo
  });

});


const PORT = 3000;
httpServer.listen(PORT, () => {
  // Get network interfaces

  interface NetworkResults {
    [key: string]: string[];
  }
  
  const nets = networkInterfaces();
  const results: NetworkResults = {};

  // Collect all IP addresses
  for (const name of Object.keys(nets)) {
    const interfaces = nets[name];
    if (interfaces)
    for (const net of interfaces) {
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
