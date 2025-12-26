import axios from 'axios';
import WebSocket from 'ws';
import https from 'https';
import chalk from 'chalk';

/**
 * Go RPC Server Client
 */
class ServerClient {
  constructor(config) {
    this.restBaseUrl = config.server.rest.baseUrl;
    this.wsUrl = config.server.websocket.url;
    this.wsConnection = null;
    this.wsListeners = new Map();
    this.pingInterval = null;
    this.connecting = false; // Flag to prevent multiple simultaneous connections
  }

  /**
   * Health check - uses REST API (domain)
   * @returns {Promise<Object>}
   */
  async healthCheck() {
    // For HTTPS connections to testnet, configure agent to handle SSL
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false, // Allow self-signed certificates for testnet
    });
    
    const axiosConfig = {
      timeout: 30000,
      validateStatus: (status) => status < 500,
      httpsAgent: this.restBaseUrl.startsWith('https://') ? httpsAgent : undefined,
    };
    
    try {
      // Try /rpc/status first (more reliable endpoint)
      const response = await axios.get(`${this.restBaseUrl}/rpc/status`, axiosConfig);
      return response.data;
    } catch (error) {
      // Fallback to /api if /rpc/status fails
      try {
        const response = await axios.get(`${this.restBaseUrl}/api`, axiosConfig);
        return response.data;
      } catch (fallbackError) {
        if (error.code === 'ECONNABORTED' || fallbackError.code === 'ECONNABORTED') {
          throw new Error(`Server health check failed: timeout of 30000ms exceeded`);
        }
        throw new Error(`Server health check failed: ${error.message || fallbackError.message}`);
      }
    }
  }

  /**
   * Get network status
   * @returns {Promise<Object>}
   */
  async getNetworkStatus() {
    try {
      const response = await axios.get(`${this.restBaseUrl}/network`, {
        timeout: 30000, // Increased timeout for domain requests
      });
      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error(`Failed to get network status: timeout of ${error.config.timeout}ms exceeded`);
      }
      throw new Error(`Failed to get network status: ${error.message}`);
    }
  }

  /**
   * Get detailed status
   * @returns {Promise<Object>}
   */
  async getDetailedStatus() {
    try {
      const response = await axios.get(`${this.restBaseUrl}/rpc/status`, {
        timeout: 30000, // Increased timeout for domain requests
        validateStatus: (status) => status < 500, // Accept any status < 500
      });
      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        throw new Error(`Failed to get detailed status: timeout of ${error.config.timeout}ms exceeded`);
      }
      throw new Error(`Failed to get detailed status: ${error.message}`);
    }
  }

  /**
   * Get balance for address
   * @param {string} address - Wallet address
   * @returns {Promise<string>}
   */
  async getBalance(address) {
    try {
      const response = await axios.get(`${this.restBaseUrl}/pg-bal/${address}`, {
        timeout: 10000,
      });
      return response.data.balance || '0';
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  /**
   * Get transaction by hash
   * @param {string} hash - Transaction hash
   * @returns {Promise<Object>}
   */
  async getTransaction(hash) {
    try {
      const response = await axios.get(`${this.restBaseUrl}/pg-tx/${hash}`, {
        timeout: 10000,
      });
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      throw new Error(`Failed to get transaction: ${error.message}`);
    }
  }

  /**
   * Get all transactions for address
   * @param {string} address - Wallet address
   * @returns {Promise<Array>}
   */
  async getTransactions(address) {
    try {
      const response = await axios.get(`${this.restBaseUrl}/pg-alltx/${address}`, {
        timeout: 10000,
      });
      return response.data || [];
    } catch (error) {
      throw new Error(`Failed to get transactions: ${error.message}`);
    }
  }

  /**
   * Send transaction
   * @param {Object} transaction - Transaction data
   * @returns {Promise<Object>}
   */
  async sendTransaction(transaction) {
    try {
      const response = await axios.post(`${this.restBaseUrl}/pg-sendtx`, transaction, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // Longer timeout for transaction submission
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to send transaction: ${error.message}`);
    }
  }

  /**
   * Connect to WebSocket
   * @returns {Promise<void>}
   */
  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      try {
        // Close existing connection if any
        if (this.wsConnection) {
          try {
            this.wsConnection.close();
          } catch (e) {
            // Ignore close errors
          }
          this.wsConnection = null;
        }
        
        // Create WebSocket connection
        // For WSS connections, configure options to handle SSL certificates
        const wsOptions = {};
        if (this.wsUrl.startsWith('wss://')) {
          // For testnet, allow self-signed certificates
          wsOptions.rejectUnauthorized = false;
        }
        this.wsConnection = new WebSocket(this.wsUrl, wsOptions);
        
        const timeout = setTimeout(() => {
          if (this.wsConnection && this.wsConnection.readyState !== WebSocket.OPEN) {
            this.connecting = false;
            if (this.wsConnection) {
              this.wsConnection.close();
            }
            this.wsConnection = null;
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000); // 10 second timeout
        
        this.wsConnection.on('open', () => {
          clearTimeout(timeout);
          this.connecting = false;
          // WebSocket server automatically registers clients on connection
          // The server will see this as a new client connection
          // Send a ping message (not ping frame) to keep connection alive
          if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
            try {
              // Send ping message to keep connection alive
              this.wsConnection.send(JSON.stringify({
                type: 'ping',
                timestamp: Date.now()
              }));
              
              // Set up periodic ping to keep connection alive
              if (this.pingInterval) {
                clearInterval(this.pingInterval);
              }
              this.pingInterval = setInterval(() => {
                if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
                  try {
                    this.wsConnection.send(JSON.stringify({
                      type: 'ping',
                      timestamp: Date.now()
                    }));
                  } catch (e) {
                    // Ignore ping errors
                  }
                }
              }, 30000); // Ping every 30 seconds
            } catch (e) {
              // Ignore ping errors
            }
          }
          resolve();
        });
        
        this.wsConnection.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleWebSocketMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        });
        
        this.wsConnection.on('error', (error) => {
          clearTimeout(timeout);
          this.connecting = false;
          // Don't reject if connection is already open (might be a minor error)
          if (this.wsConnection && this.wsConnection.readyState !== WebSocket.OPEN) {
            reject(new Error(`WebSocket error: ${error.message || 'Connection failed'}`));
          }
        });
        
        this.wsConnection.on('close', () => {
          clearTimeout(timeout);
          this.connecting = false;
          // Clear ping interval
          if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
          }
          this.wsConnection = null;
          // Try to reconnect after 5 seconds if we're in interactive mode
          if (process.stdin.isTTY && !this.connecting) {
            setTimeout(() => {
              if (!this.wsConnection || (this.wsConnection && this.wsConnection.readyState === WebSocket.CLOSED)) {
                this.connectWebSocket().catch(() => {
                  // Silent reconnect failure
                });
              }
            }, 5000);
          }
        });
        
        // Handle pong for keepalive (if ping is supported)
        if (typeof this.wsConnection.on === 'function') {
          this.wsConnection.on('pong', () => {
            // Connection is alive
          });
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle WebSocket messages
   * @param {Object} message - WebSocket message
   * @param {Function} onMessageReceived - Callback for received messages (optional)
   */
  handleWebSocketMessage(message, onMessageReceived = null) {
    // Handle incoming messages
    if (message.type === 'message') {
      const data = message.data || {};
      const timestamp = data.timestamp ? data.timestamp * 1000 : Date.now();
      
      // Always trigger 'message' event for external handlers (like messageStorage)
      const listeners = this.wsListeners.get('message') || [];
      listeners.forEach(listener => listener(data));
      
      // Call callback if provided (for backward compatibility)
      if (onMessageReceived) {
        onMessageReceived(data.from, data.to, data.text, timestamp);
      }
    }
    
    // Handle registered event
    if (message.type === 'registered' && message.data) {
      const listeners = this.wsListeners.get('registered') || [];
      listeners.forEach(listener => listener(message.data));
    }
    
    // Handle messageSent event
    if (message.type === 'messageSent' && message.data) {
      const listeners = this.wsListeners.get('messageSent') || [];
      listeners.forEach(listener => listener(message.data));
    }
    
    // Handle messageError event
    if (message.type === 'messageError' && message.data) {
      const listeners = this.wsListeners.get('messageError') || [];
      listeners.forEach(listener => listener(message.data));
    }
    
    // Handle other event types
    if (message.type && this.wsListeners.has(message.type)) {
      const listeners = this.wsListeners.get(message.type);
      listeners.forEach(listener => listener(message.data || message));
    }
  }

  /**
   * Subscribe to WebSocket events
   * @param {string} eventType - Event type
   * @param {Function} callback - Callback function
   */
  on(eventType, callback) {
    if (!this.wsListeners.has(eventType)) {
      this.wsListeners.set(eventType, []);
    }
    this.wsListeners.get(eventType).push(callback);
  }

  /**
   * Unsubscribe from WebSocket events
   * @param {string} eventType - Event type
   * @param {Function} callback - Callback function to remove
   */
  off(eventType, callback) {
    if (this.wsListeners.has(eventType)) {
      const listeners = this.wsListeners.get(eventType);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
      if (listeners.length === 0) {
        this.wsListeners.delete(eventType);
      }
    }
  }

  /**
   * Ensure WebSocket is connected
   * @returns {Promise<void>}
   */
  async ensureConnected() {
    // If already connected, return immediately
    if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
      return;
    }
    
    // If already connecting, wait for it
    if (this.connecting) {
      // Wait up to 10 seconds for connection to complete
      for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
          return;
        }
        if (!this.connecting) {
          break;
        }
      }
      // If still not connected after waiting, try to connect again
      if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
        this.connecting = false;
      }
    }
    
    // Try to connect
    if (!this.connecting) {
      this.connecting = true;
      try {
        await this.connectWebSocket();
      } catch (error) {
        this.connecting = false;
        throw new Error(`Failed to connect WebSocket: ${error.message}`);
      }
    }
  }

  /**
   * Register wallet address with server
   * @param {string} address - Wallet address
   * @returns {Promise<void>}
   */
  async registerAddress(address) {
    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('registered', handler);
        reject(new Error('Address registration timeout'));
      }, 10000); // Increased timeout to 10 seconds

      const handler = (data) => {
        if (data && data.address === address) {
          clearTimeout(timeout);
          this.off('registered', handler);
          resolve();
        }
      };

      this.on('registered', handler);

      this.wsConnection.send(JSON.stringify({
        type: 'register',
        data: {
          address: address,
        },
      }));
    });
  }

  /**
   * Send message to recipient
   * @param {string} from - Sender address
   * @param {string} to - Recipient address
   * @param {string} text - Message text
   * @returns {Promise<Object>}
   */
  async sendMessage(from, to, text) {
    // ensureConnected is already called in registerAddress, but ensure it's connected
    if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
      await this.ensureConnected();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off('messageSent', successHandler);
        this.off('messageError', errorHandler);
        reject(new Error('Message send timeout'));
      }, 15000); // Increased timeout to 15 seconds

      const successHandler = (data) => {
        if (data && data.to === to) {
          clearTimeout(timeout);
          this.off('messageSent', successHandler);
          this.off('messageError', errorHandler);
          resolve(data);
        }
      };

      const errorHandler = (data) => {
        clearTimeout(timeout);
        this.off('messageSent', successHandler);
        this.off('messageError', errorHandler);
        reject(new Error(data && data.error ? data.error : 'Failed to send message'));
      };

      this.on('messageSent', successHandler);
      this.on('messageError', errorHandler);

      this.wsConnection.send(JSON.stringify({
        type: 'message',
        data: {
          from: from,
          to: to,
          text: text,
        },
      }));
    });
  }

  /**
   * Close WebSocket connection
   */
  closeWebSocket() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
  }
}

export default ServerClient;
