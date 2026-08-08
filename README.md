# 🎬 ClipGrab

> **Serverless Cross-Device Media Downloader & Sync Platform**  
> Built with Turborepo, Tauri v2 (Rust + React), Expo (React Native), WebExtensions, and Neon Serverless Postgres.

---

## 🎯 Project Motive & Vision

Traditional media download tools and cross-device clip sync utilities suffer from three critical flaws:

1. **Hosting Costs & Maintenance Overhead**: Running custom API backends to process video links or relay real-time websockets incurs ongoing server costs.
2. **Privacy Concerns & Data Tracking**: Centralized servers capture and inspect every link user copies or downloads.
3. **Fragmented Workflows**: Downloading a video on mobile requires copying links to messaging apps or emailing yourself to open on desktop.

### The ClipGrab Solution

**ClipGrab** solves this by pioneering a **BYOD (Bring Your Own Database)** serverless architecture.

- **Zero Third-Party API Servers**: All clients (Desktop, Mobile, Extension) communicate directly with your private **Neon Postgres** database over the **Neon HTTP API**.
- **Unified Master Command Center**: Your Mac/PC (`apps/desktop`) acts as the Master Command Center. It displays a QR Code to pair Mobile & Extension targets instantly.
- **Local Native Downloading**: Mobile and Extension clients **never** waste bandwidth downloading large media files. They simply push URL tasks to your serverless Neon `media_queue` table. Your Desktop Command Center continuously polls the database and executes native high-performance downloads locally via `yt-dlp` / `ffmpeg`.

---

## 🏗️ Architecture & Tech Stack

```
                                  ┌────────────────────────┐
                                  │   Browser Extension    │
                                  │ (Manifest V3 Context)  │
                                  └───────────┬────────────┘
                                              │ Direct HTTP
┌────────────────────────┐                    │ Enqueue
│   Expo Mobile App      │                    ▼
│ (Camera QR + Secure)   ├───────────► ┌──────────────┐
└────────────────────────┘ Direct HTTP │ Serverless   │
                           Enqueue     │ Neon DB      │
                                       │ (Postgres)   │
┌────────────────────────┐             └──────┬───────┘
│ Tauri Desktop Master   │                    │ Direct HTTP
│ (Rust + React + yt-dlp)├────────────────────┘ Poll & Update
└────────────────────────┘ Status
```

### Stack Breakdown

- **Monorepo Tooling**: [Turborepo](https://turbo.build/) + [pnpm Workspaces](https://pnpm.io/)
- **Master Command Center**: [Tauri v2](https://tauri.app/) (Rust Backend) + React (TypeScript) + Tailwind CSS
- **Mobile Client**: [Expo](https://expo.dev/) (React Native) + `expo-camera` (QR Scanning) + `expo-secure-store`
- **WebExtension**: Manifest V3 + Vite + Chrome Storage API
- **Database Layer**: [Neon Serverless Postgres](https://neon.tech/) via `@neondatabase/serverless` & [Drizzle ORM](https://orm.drizzle.team/) over HTTP

---

## 📁 Monorepo Workspace Structure

```
clipgrab/
├── apps/
│   ├── desktop/           # Tauri v2 + React Master Command Center & QR Pairing UI
│   ├── extension/         # Manifest V3 WebExtension (Vite + React)
│   └── mobile/            # Expo React Native App (QR Scanner + Share Target)
├── packages/
│   ├── db/                # Drizzle ORM Schema, Neon HTTP API Client, Auto-Migrator
│   ├── core-downloader/   # RegEx platform detection rules & URL parsers
│   ├── ui/                # Shared Tailwind CSS + React Component Library
│   ├── config/            # Shared TypeScript (tsconfig.base.json) & Tooling Configs
│   └── types/             # Shared Cross-Platform TypeScript Type Definitions
├── turbo.json             # Turborepo Build Pipeline Configuration
├── pnpm-workspace.yaml    # Workspace Directory Definitions
└── package.json           # Root Dependencies & Build Scripts
```

---

## 🔐 BYOD QR Pairing Flow

1. **Setup**: On first launch, open `apps/desktop` and paste your Neon HTTP Connection String (`postgresql://...`).
2. **Auto-Migration**: Tauri automatically provisions all required Drizzle schema tables (`media_queue`, `device_nodes`, `clipboards`, `user_configs`) directly over Neon HTTP.
3. **QR Generation**: Tauri generates a secure `pass_id` UUID, packages `{ databaseUrl, passId, createdAt }` into a Base64 JSON payload, and renders a **QR Code**.
4. **Mobile Pairing**: Scan the Mac QR Code using the Expo Mobile App. The credentials are encrypted into `expo-secure-store`.
5. **Extension Pairing**: Copy the Base64 pairing string from the Mac UI into the Extension Popup to save to `chrome.storage.local`.

---

## 🚀 Getting Started & Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) `>= 20.0.0`
- [pnpm](https://pnpm.io/) `>= 9.0.0`
- [Rust & Cargo](https://www.rust-lang.org/) (for Tauri desktop app)

### 1. Installation

```bash
git clone https://github.com/mistjsxr/clipgrab.git
cd clipgrab
pnpm install
```

### 2. Monorepo Build Verification

```bash
pnpm build
```

### 3. Running Applications

#### Desktop Command Center (Tauri v2 + React)

```bash
pnpm --filter @clipgrab/desktop tauri dev
```

#### Browser Extension (Vite WebExtension)

```bash
pnpm --filter @clipgrab/extension build
```

_To load into Chrome/Edge:_ Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `apps/extension/dist`.

#### Mobile Application (Expo React Native)

```bash
pnpm --filter @clipgrab/mobile dev
```

---

## 🧪 Shared Package Overview

| Package                                                   | Purpose                                                                                 |
| :-------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| [`@clipgrab/db`](./packages/db)                           | Drizzle ORM tables & `@neondatabase/serverless` client factory                          |
| [`@clipgrab/core-downloader`](./packages/core-downloader) | RegEx pattern detection for YouTube, X, TikTok, Instagram, and Direct files             |
| [`@clipgrab/ui`](./packages/ui)                           | Shared React component library (`Button`, `Card`, `QRCodeView`, `StatusBadge`, `Input`) |
| [`@clipgrab/types`](./packages/types)                     | Centralized TypeScript interface contracts (`MediaJob`, `DeviceNode`, `PairingPayload`) |

---
