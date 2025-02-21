"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var socket_io_1 = require("socket.io");
var http_1 = require("http");
var express = require("express");
var admin_ui_1 = require("@socket.io/admin-ui");
var os_1 = require("os");
var ioredis_1 = require("ioredis");
var redis_adapter_1 = require("@socket.io/redis-adapter");
var socket_1 = require("./socket/");
var app = express();
var httpServer = (0, http_1.createServer)(app);
var redis = new ioredis_1.Redis();
var redisSub = redis.duplicate();
var state = new socket_1.SocketState();
app.use(express.json());
var io = new socket_io_1.Server(httpServer, {
    adapter: (0, redis_adapter_1.createAdapter)(redis, redisSub),
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
(0, admin_ui_1.instrument)(io, {
    auth: false,
    mode: "development",
});
//const HEARTBEAT_INTERVAL = 30000;
//const PRESENCE_TIMEOUT = 60000;
io.use(socket_1.socketMiddleware);
io.on("connection", function (socket) {
    console.log("Client connected:", socket.id);
    var presenceHandler = (0, socket_1.handlePresence)(io, socket, state.clientPresence);
    presenceHandler.enterPresence();
    socket.on('disconnecting', function (reason) {
        //todo
    });
    socket.on('disconnect', function (reason) {
        //todo
    });
});
var PORT = 3000;
httpServer.listen(PORT, function () {
    // Get network interfaces
    var nets = (0, os_1.networkInterfaces)();
    var results = {};
    // Collect all IP addresses
    for (var _i = 0, _a = Object.keys(nets); _i < _a.length; _i++) {
        var name_1 = _a[_i];
        var interfaces = nets[name_1];
        if (interfaces)
            for (var _b = 0, interfaces_1 = interfaces; _b < interfaces_1.length; _b++) {
                var net = interfaces_1[_b];
                // Skip internal (i.e. 127.0.0.1) and non-IPv4 addresses
                if (net.family === 'IPv4' && !net.internal) {
                    if (!results[name_1]) {
                        results[name_1] = [];
                    }
                    results[name_1].push(net.address);
                }
            }
    }
    console.log('Server IP addresses:');
    Object.keys(results).forEach(function (iface) {
        console.log("".concat(iface, ": ").concat(results[iface].join(', ')));
    });
    console.log("TernSecure WebSocket server running on port ".concat(PORT));
});
process.on('SIGTERM', function () {
    //clearInterval(cleanupInterval);
    console.log('SIGTERM received. Closing server...');
    httpServer.close(function () {
        redis.quit();
        redisSub.quit();
        console.log('Server closed');
        process.exit(0);
    });
});
