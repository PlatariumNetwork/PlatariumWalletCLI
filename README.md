# Platarium Wallet CLI

<div align="center">
  <img width="200px" height="200px" src="https://prevedere.platarium.com/logo/PlatariumWalletCLI.png" alt="Platarium Wallet CLI Logo">
  
  **Command-line wallet for the Platarium blockchain**
  
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
</div>

## Overview

Platarium Wallet CLI is a cross-platform command-line interface for managing Platarium wallets, sending transactions, and exchanging messages with other users on the Platarium network. Built with Node.js and powered by Rust Core for cryptographic operations.

## Features

- 🔐 **Wallet Management**: Create, restore, and manage multiple wallets
- 💰 **Transaction Support**: Send and receive transactions
- 💬 **P2P Messaging**: Real-time messaging between wallet addresses
- 🌐 **Network Status**: Check blockchain network status
- 🔒 **Secure**: Uses Platarium Core (Rust) for cryptographic operations
- 🖥️ **Cross-Platform**: Works on Windows, macOS, and Linux

## Prerequisites

- **Node.js** (v18 or higher)
- **Rust** (will be installed automatically if not present)
- **Git** (required for building from source)

### Windows Additional Requirements

- **Visual Studio Build Tools** or **MinGW-w64** (for compiling Rust code)
  - Download: https://visualstudio.microsoft.com/downloads/
  - Select "Desktop development with C++" workload

## Installation

1. Clone the repository:
```bash
git clone https://github.com/PlatariumNetwork/walletPlatariumCLI.git
cd walletPlatariumCLI
```

2. Install and setup:
```bash
npm start
```

The setup script will automatically:
- Install npm dependencies
- Check for Rust (prompts to install if missing)
- Clone and build Platarium Core
- Run verification tests

## Usage

### Interactive Mode (Recommended)

Simply run:
```bash
npm start
```

This launches an interactive menu where you can:
- Create new wallets
- Restore wallets from mnemonic
- Load existing wallets
- Send transactions
- Send and receive messages
- Check balances
- View network status

### Command Line Mode

```bash
# Create a new wallet
npm start create --name mywallet

# Restore wallet from mnemonic
npm start restore --name mywallet --mnemonic "your mnemonic phrase" --alphanumeric "your code"

# List all wallets
npm start list

# Check balance
npm start balance --address Px...

# Network status
npm start status
```

## Configuration

Default configuration is stored in `config/default.json`:

```json
{
  "server": {
    "rest": {
      "baseUrl": "https://rpc-melancholy-testnet.platarium.network"
    },
    "websocket": {
      "url": "wss://rpc-melancholy-testnet.platarium.network/ws/"
    }
  }
}
```

## Project Structure

```
walletPlatariumCLI/
├── src/
│   ├── index.js              # Main entry point
│   ├── api/
│   │   └── serverClient.js   # REST and WebSocket client
│   ├── cli/
│   │   └── interactive.js    # Interactive CLI interface
│   ├── core/
│   │   └── rustCore.js       # Rust Core wrapper
│   ├── wallet/
│   │   └── walletManager.js  # Wallet management
│   └── messaging/
│       └── messageStorage.js # Message storage
├── scripts/
│   ├── install-deps.js       # Dependency installation
│   ├── setup-rust-core.js    # Rust Core setup
│   └── verify-setup.js       # Setup verification
├── config/
│   └── default.json          # Configuration
└── README.md
```

## Development

### Manual Setup

If you prefer to set up manually:

```bash
# Install dependencies
npm install

# Setup Rust Core
npm run setup

# Run verification
npm test
```

### Building Platarium Core

Platarium Core is automatically cloned and built during setup. The binary is located at:
- `PlatariumCore/target/release/platarium-cli` (Linux/macOS)
- `PlatariumCore/target/release/platarium-cli.exe` (Windows)

## Troubleshooting

### Rust Installation Issues

**Linux/macOS**: The setup script will prompt to install Rust automatically using rustup.

**Windows**: 
- Install Visual Studio Build Tools: https://visualstudio.microsoft.com/downloads/
- Select "Desktop development with C++" during installation
- Restart terminal after installation

### Build Errors on Windows

If you encounter `link.exe not found` or `dlltool.exe not found`:
1. Ensure Visual Studio Build Tools are installed
2. Restart your terminal
3. Try running `npm start` again

### Git Not Found

Install Git and ensure it's in your PATH:
- Windows: https://git-scm.com/download/win
- macOS: `xcode-select --install`
- Linux: `sudo apt-get install git` (Ubuntu/Debian)

## Security

- Wallet files are stored locally in the `wallets/` directory
- Private keys are never transmitted over the network
- All cryptographic operations use Platarium Core (Rust)
- Messages are stored locally in the `messages/` directory

⚠️ **Important**: Always backup your mnemonic phrases securely!

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- [Platarium Network](https://platarium.network)
- [Documentation](https://docs.platarium.network)

## Support

For issues and questions:
- Open an issue on GitHub
- Check the documentation
- Visit our community forums

---

Made with ❤️ by the Platarium Network team
