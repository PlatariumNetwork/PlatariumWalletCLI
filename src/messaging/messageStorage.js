import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Message Storage - Local P2P message storage
 */
class MessageStorage {
  constructor(storagePath = null) {
    // Store messages inside walletPlatariumCLI directory
    if (!storagePath) {
      storagePath = path.join(path.dirname(__dirname), '../messages');
    }
    this.storagePath = path.resolve(storagePath);
    this.dialogsPath = path.join(this.storagePath, 'dialogs');
    this.contactsPath = path.join(this.storagePath, 'contacts.json');
  }

  /**
   * Initialize storage directories
   */
  async init() {
    try {
      if (!existsSync(this.storagePath)) {
        await mkdir(this.storagePath, { recursive: true });
      }
      if (!existsSync(this.dialogsPath)) {
        await mkdir(this.dialogsPath, { recursive: true });
      }
      if (!existsSync(this.contactsPath)) {
        await writeFile(this.contactsPath, JSON.stringify([], null, 2));
      }
    } catch (error) {
      throw new Error(`Failed to initialize message storage: ${error.message}`);
    }
  }

  /**
   * Get dialog file path for two addresses
   * @param {string} address1 - First address
   * @param {string} address2 - Second address
   * @returns {string} Dialog file path
   */
  getDialogPath(address1, address2) {
    // Sort addresses to ensure consistent file name
    const addresses = [address1, address2].sort();
    // Replace invalid characters for Windows file names and limit length
    // Windows MAX_PATH is 260, but we limit filename to 200 chars for safety
    let dialogId = `${addresses[0]}_${addresses[1]}`.replace(/[^a-zA-Z0-9_]/g, '_');
    // Truncate if too long (200 chars max for filename)
    if (dialogId.length > 200) {
      dialogId = dialogId.substring(0, 200);
    }
    return path.join(this.dialogsPath, `${dialogId}.json`);
  }

  /**
   * Get or create dialog
   * @param {string} address1 - First address
   * @param {string} address2 - Second address
   * @returns {Promise<Object>} Dialog object
   */
  async getDialog(address1, address2) {
    const dialogPath = this.getDialogPath(address1, address2);
    
    if (existsSync(dialogPath)) {
      const data = await readFile(dialogPath, 'utf-8');
      return JSON.parse(data);
    }

    // Create new dialog
    // If addresses are the same, ensure both are in participants array
    const participants = address1 === address2 
      ? [address1, address2] // Keep both for self-dialog
      : [address1, address2].sort();
    
    const dialog = {
      participants,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.saveDialog(dialog);
    return dialog;
  }

  /**
   * Save dialog
   * @param {Object} dialog - Dialog object
   */
  async saveDialog(dialog) {
    const dialogPath = this.getDialogPath(dialog.participants[0], dialog.participants[1]);
    dialog.updatedAt = Date.now();
    await writeFile(dialogPath, JSON.stringify(dialog, null, 2));
  }

  /**
   * Add message to dialog
   * @param {string} from - Sender address
   * @param {string} to - Recipient address
   * @param {string} text - Message text
   * @param {number} timestamp - Message timestamp
   * @returns {Promise<Object>} Added message
   */
  async addMessage(from, to, text, timestamp = Date.now()) {
    const dialog = await this.getDialog(from, to);
    
    const message = {
      id: `${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
      from,
      to,
      text,
      timestamp,
      read: false,
    };

    dialog.messages.push(message);
    await this.saveDialog(dialog);

    // Update contacts list
    await this.updateContacts(from, to);

    return message;
  }

  /**
   * Get all dialogs for an address
   * @param {string} address - Wallet address
   * @returns {Promise<Array>} List of dialogs
   */
  async getDialogs(address) {
    const dialogs = [];
    
    if (!existsSync(this.dialogsPath)) {
      return dialogs;
    }

    const files = await readdir(this.dialogsPath);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const filePath = path.join(this.dialogsPath, file);
        const data = await readFile(filePath, 'utf-8');
        const dialog = JSON.parse(data);
        
        // Check if address is participant
        if (dialog.participants && Array.isArray(dialog.participants) && dialog.participants.includes(address)) {
          // Find other participant (or use same address if dialog with self)
          let otherParticipant = dialog.participants.find(p => p && p !== address);
          
          // If no other participant found, it's a dialog with self
          if (!otherParticipant) {
            // Check if it's a self-dialog (same address appears twice or only one unique address)
            const uniqueParticipants = [...new Set(dialog.participants)];
            if (uniqueParticipants.length === 1 && uniqueParticipants[0] === address) {
              otherParticipant = address; // Dialog with self
            }
          }
          
          const lastMessage = dialog.messages && dialog.messages.length > 0 
            ? dialog.messages[dialog.messages.length - 1]
            : null;
          
          // Always add dialog if address is participant (including self-dialogs)
          if (otherParticipant || (dialog.participants.length > 0 && dialog.participants[0] === address)) {
            dialogs.push({
              ...dialog,
              otherParticipant: otherParticipant || address, // Use address if no other participant
              lastMessage,
              unreadCount: (dialog.messages || []).filter(m => m && m.to === address && !m.read).length,
            });
          }
        }
      } catch (error) {
        // Skip corrupted files
        continue;
      }
    }

    // Sort by last message timestamp (most recent first)
    dialogs.sort((a, b) => {
      const aTime = a.lastMessage ? a.lastMessage.timestamp : a.updatedAt;
      const bTime = b.lastMessage ? b.lastMessage.timestamp : b.updatedAt;
      return bTime - aTime;
    });

    return dialogs;
  }

  /**
   * Get messages for a dialog
   * @param {string} address1 - First address
   * @param {string} address2 - Second address
   * @param {number} limit - Maximum number of messages to return
   * @returns {Promise<Array>} List of messages
   */
  async getMessages(address1, address2, limit = 50) {
    const dialog = await this.getDialog(address1, address2);
    // Sort messages by timestamp to ensure correct order
    const sortedMessages = dialog.messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    return sortedMessages.slice(-limit);
  }

  /**
   * Mark messages as read
   * @param {string} address1 - First address
   * @param {string} address2 - Second address
   * @param {string} currentAddress - Address marking messages as read
   */
  async markAsRead(address1, address2, currentAddress) {
    const dialog = await this.getDialog(address1, address2);
    let updated = false;

    for (const message of dialog.messages) {
      if (message.to === currentAddress && !message.read) {
        message.read = true;
        updated = true;
      }
    }

    if (updated) {
      await this.saveDialog(dialog);
    }
  }

  /**
   * Update contacts list
   * @param {string} address1 - First address
   * @param {string} address2 - Second address
   */
  async updateContacts(address1, address2) {
    let contacts = [];
    
    if (existsSync(this.contactsPath)) {
      try {
        const data = await readFile(this.contactsPath, 'utf-8');
        contacts = JSON.parse(data);
      } catch (error) {
        contacts = [];
      }
    }

    // Add both addresses as contacts if not already present
    const addresses = [address1, address2];
    for (const addr of addresses) {
      if (!contacts.find(c => c.address === addr)) {
        contacts.push({
          address: addr,
          addedAt: Date.now(),
          lastMessageAt: Date.now(),
        });
      } else {
        // Update last message time
        const contact = contacts.find(c => c.address === addr);
        contact.lastMessageAt = Date.now();
      }
    }

    await writeFile(this.contactsPath, JSON.stringify(contacts, null, 2));
  }

  /**
   * Get all contacts
   * @returns {Promise<Array>} List of contacts
   */
  async getContacts() {
    if (!existsSync(this.contactsPath)) {
      return [];
    }

    try {
      const data = await readFile(this.contactsPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get total unread message count for an address
   * @param {string} address - Wallet address
   * @returns {Promise<number>} Total unread messages count
   */
  async getUnreadCount(address) {
    const dialogs = await this.getDialogs(address);
    return dialogs.reduce((total, dialog) => total + (dialog.unreadCount || 0), 0);
  }
}

export default MessageStorage;
