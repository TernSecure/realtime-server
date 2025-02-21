"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socketMiddleware = void 0;
// Utility function to mask sensitive data
var maskSensitive = function (text, showLength) {
    if (showLength === void 0) { showLength = 4; }
    if (!text)
        return '';
    var visiblePart = text.slice(0, showLength);
    return "".concat(visiblePart).concat('*'.repeat(text.length - showLength));
};
// Socket authentication middleware
var socketMiddleware = function (socket, next) {
    var _a = socket.handshake.auth, clientId = _a.clientId, apiKey = _a.apiKey;
    if (!clientId || !apiKey) {
        console.log('Connection rejected: Missing credentials');
        return next(new Error('Authentication failed: Missing clientId or apiKey'));
    }
    console.log("Authentication successful for client ".concat(maskSensitive(clientId)));
    console.log("Using API key: ".concat(maskSensitive(apiKey)));
    next();
};
exports.socketMiddleware = socketMiddleware;
