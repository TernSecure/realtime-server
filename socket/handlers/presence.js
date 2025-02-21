"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePresence = void 0;
var handlePresence = function (io, socket, clientPresence) {
    var _a = socket.handshake.auth, clientId = _a.clientId, apiKey = _a.apiKey;
    var enterPresence = function () {
        console.log("Initializing presence for client ".concat(clientId, " with socket ").concat(socket.id));
        var presence = {
            status: 'online',
            customMessage: '',
            lastUpdated: new Date().toISOString(),
            socketId: socket.id
        };
        clientPresence.set(clientId, presence);
        var existingMembers = Array.from(clientPresence.entries())
            .map(function (_a) {
            var clientId = _a[0], presence = _a[1];
            return ({
                clientId: clientId,
                presence: presence
            });
        });
        socket.emit('presence:sync', existingMembers);
        socket.broadcast.to("key:".concat(apiKey)).emit('presence:enter', {
            clientId: clientId,
            presence: presence
        });
    };
    socket.on('presence:update', function (_a) {
        var status = _a.status, customMessage = _a.customMessage;
        var presence = {
            status: status,
            customMessage: customMessage,
            lastUpdated: new Date().toISOString(),
            socketId: socket.id
        };
        clientPresence.set(clientId, presence);
        io.to("key:".concat(apiKey)).emit('presence:update', { clientId: clientId, presence: presence });
    });
    socket.on('presence:heartbeat', function () {
        var presence = clientPresence.get(clientId);
        if (presence) {
            presence.lastHeartbeat = Date.now();
            presence.lastUpdated = new Date().toISOString();
        }
    });
    return {
        enterPresence: enterPresence
    };
};
exports.handlePresence = handlePresence;
