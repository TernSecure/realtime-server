"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketState = void 0;
var SocketState = /** @class */ (function () {
    function SocketState() {
        this.clientPresence = new Map();
        this.roomMembers = new Map();
        this.clientSockets = new Map();
        this.socketToClient = new Map();
        this.keyToClients = new Map();
        this.userPresence = new Map();
        this.clientRooms = new Map();
    }
    return SocketState;
}());
exports.SocketState = SocketState;
