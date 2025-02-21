import { networkInterfaces } from 'os';

interface NetworkResults {
  [key: string]: string[];
}

export const getNetworkAddresses = (): NetworkResults => {
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

  return results;
};

export const logNetworkAddresses = (port: number): void => {
  const results = getNetworkAddresses();
  
  console.log('Server IP addresses:');
  Object.keys(results).forEach(iface => {
    console.log(`${iface}: ${results[iface].join(', ')}`);
  });
  console.log(`TernSecure WebSocket server running on port ${port}`);
};
