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