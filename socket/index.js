"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.socketMiddleware = exports.SocketState = void 0;
__exportStar(require("./handlers/presence"), exports);
var state_1 = require("./state");
Object.defineProperty(exports, "SocketState", { enumerable: true, get: function () { return state_1.SocketState; } });
var middleware_1 = require("./middleware");
Object.defineProperty(exports, "socketMiddleware", { enumerable: true, get: function () { return middleware_1.socketMiddleware; } });
