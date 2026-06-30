# Platarium Wallet CLI

<div align="center">
  <img width="200" height="200" src="https://prevedere.platarium.com/logo/PlatariumWalletCLI.png" alt="Platarium Wallet CLI">
  <br><br>
  <strong>Command-line wallet for the Platarium blockchain</strong>
  <br><br>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</div>

## Overview

Platarium Wallet CLI is a cross-platform terminal wallet for the Platarium network. It supports encrypted local storage, mnemonic restore (aligned with the Chrome extension), gateway transaction signing, and optional P2P messaging.

Cryptography runs in JavaScript (`@scure/bip39`, `@noble/secp256k1`) with parity checks against **PlatariumCore** (`platarium-cli`) during setup.

## Features

- Encrypted vault (PBKDF2 + AES-GCM) for mnemonics and wallet secrets
- Create, restore, and manage multiple accounts (HD `seedIndex`)
- Gateway transaction signing (dual-key, same as the extension)
- Interactive menu and non-interactive CLI commands
- Optional messaging over WebSocket
- One-command bootstrap: `npm start` installs, verifies, and launches

## Requirements

| Requirement | Notes |
|-------------|--------|
| **Node.js** ≥ 18 | Required |
| **Git** | Required for PlatariumCore source sync |
| **Rust / Cargo** | Required to build `platarium-cli` on first run |
| **Windows** | [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/) (Desktop development with C++) for Rust builds |

## Quick start

### Standalone repository

```bash
git clone https://github.com/PlatariumNetwork/walletPlatariumCLI.git
cd walletPlatariumCLI
npm start
```

### Monorepo (`PlatariumNetwork`)

If this folder sits next to `PlatariumCore/`:

```bash
cd walletPlatariumCLI
npm start
```

Setup uses `../PlatariumCore` automatically (no nested clone inside the wallet).

`npm start` will:

1. Install npm dependencies (if needed)
2. Verify Node.js, Rust, Git, and PlatariumCore git revision (HTTPS)
3. Build or reuse `platarium-cli`
4. Run cryptographic verification tests
5. Launch the interactive wallet

## Usage

### Interactive mode (default)

```bash
npm start
```

### CLI commands

Pass arguments after `npm start --`:

| Command | Description |
|---------|-------------|
| `interactive` | Interactive menu (default when no command) |
| `unlock` / `lock` | Session vault unlock / lock |
| `create` | New wallet (`--name`) |
| `restore` | Restore from mnemonic (`--name`, `--mnemonic`, `--alphanumeric`) |
| `add-account` | HD account on existing wallet (`--wallet`, `--seed-index`) |
| `delete` | Remove wallet (`--wallet`) |
| `secrets` | Show mnemonic / alphanumeric (unlocked session) |
| `list` | List wallets and addresses |
| `balance` | Query balance (`--address`) |
| `status` | Vault and storage status |

```bash
npm start -- create --name mywallet
npm start -- restore --name mywallet --mnemonic "..." --alphanumeric "..."
npm start -- list
npm start -- balance --address Px...
```

## PlatariumCore integration

Binary resolution order (same as PlatariumGatewayGO):

1. `PLATARIUM_CLI_PATH`
2. `../PlatariumCore/target/release/platarium-cli` (monorepo)
3. `platarium-cli` on `PATH`

Source tree resolution:

1. `PLATARIUM_CORE_ROOT`
2. `../PlatariumCore` (monorepo)
3. `walletPlatariumCLI/PlatariumCore` (standalone clone fallback)

PlatariumCore is a **public** repository; git checks use **HTTPS** (`https://github.com/PlatariumNetwork/PlatariumCore.git`).

### Optional environment variables

| Variable | Purpose |
|----------|---------|
| `PLATARIUM_CLI_PATH` | Path to `platarium-cli` binary |
| `PLATARIUM_CORE_ROOT` | Path to PlatariumCore source tree |
| `PLATARIUM_CORE_AUTO_PULL=1` | Auto `git pull` when local commit is behind remote |
| `PLATARIUM_GIT_FETCH_TIMEOUT_MS` | Timeout for remote git checks (default `8000`) |

## Configuration

Default RPC endpoints: `config/default.json`

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

## Project structure

```
walletPlatariumCLI/
├── config/default.json       # Network endpoints
├── scripts/
│   ├── bootstrap.js          # npm start entry (setup + launch)
│   ├── install-deps.js       # npm dependency checks
│   ├── setup-rust-core.js    # Rust / Core / git verification
│   ├── verify-setup.js       # platarium-cli integration tests
│   └── test-crypto.mjs       # JS crypto parity tests
├── src/
│   ├── index.js              # CLI entry (commander)
│   ├── api/serverClient.js   # REST + WebSocket client
│   ├── cli/                  # Interactive UI, branding, lifecycle
│   ├── core/                 # platarium-cli paths + Rust wrapper
│   ├── crypto/               # Platarium crypto (extension parity)
│   ├── wallet/               # vault, walletManager
│   └── messaging/            # Local message storage
├── package.json
└── package-lock.json
```

## Development scripts

```bash
npm run setup    # Environment setup only (no wallet UI)
npm test         # Verify platarium-cli integration
npm run test:crypto   # JS crypto tests
```

## Security

- **Never commit** `wallets/`, `messages/`, `.env`, or `node_modules/`
- Wallet secrets are encrypted at rest; session keys live in memory only
- Mnemonics and alphanumeric codes are required for restore (same scheme as the Chrome extension)
- Testnet TLS may use self-signed certificates (`rejectUnauthorized: false` in `serverClient.js` for testnet only)

Always back up your mnemonic and alphanumeric code offline.

## Troubleshooting

**Rust build fails on Windows** - install Visual Studio Build Tools with the C++ workload, restart the terminal, run `npm start` again.

**Git remote slow or SSH errors** - setup uses HTTPS for public PlatariumCore checks. Ensure `git` is installed and network access to `github.com` is available.

**`platarium-cli` not found** - build Core manually:

```bash
cd ../PlatariumCore   # or your PlatariumCore path
cargo build --release
export PLATARIUM_CLI_PATH="$(pwd)/target/release/platarium-cli"
```

## License

MIT - see [LICENSE](LICENSE).

## Links

- [Platarium Network](https://platarium.network)
- [PlatariumCore](https://github.com/PlatariumNetwork/PlatariumCore)
- [Issues](https://github.com/PlatariumNetwork/walletPlatariumCLI/issues)
