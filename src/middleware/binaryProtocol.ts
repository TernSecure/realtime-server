import { encryptForClient, decryptFromClient } from './encryption';

// Message format: { event: string, data: any }
export function encryptAndPackMessage(clientId: string, event: string, data: any): ArrayBuffer | null {
  try {
    // Create the complete message object
    const message = { event, data };
    
    // Convert to JSON string
    const jsonString = JSON.stringify(message);
    
    // Encrypt the entire message
    const encryptedBase64 = encryptForClient(clientId, jsonString);
    if (!encryptedBase64) return null;
    
    // Convert base64 to binary
    const binaryString = atob(encryptedBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    return bytes.buffer;
  } catch (error) {
    console.error('Error encrypting message:', error);
    return null;
  }
}

export function decryptAndUnpackMessage(clientId: string, binaryData: ArrayBuffer): { event: string, data: any } | null {
  try {
    // Convert binary to base64
    const bytes = new Uint8Array(binaryData);
    let binaryString = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binaryString += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binaryString);
    
    // Decrypt the message
    const jsonString = decryptFromClient(clientId, base64);
    if (!jsonString) return null;
    
    // Parse the JSON
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error decrypting message:', error);
    return null;
  }
}