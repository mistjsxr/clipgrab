# 🎬 ClipGrab

> **Serverless Cross-Device Media Downloader, Sync & Asset Vault Platform**  
> Built with Turborepo, Tauri v2 (Rust + React), Expo (React Native), WebExtensions, and Neon Serverless Postgres.

---

## 🎯 Project Motive & Vision

Traditional media download tools and cross-device clip sync utilities suffer from three critical flaws:

1. **Hosting Costs & Maintenance Overhead**: Running custom API backends to process video links or relay real-time websockets incurs ongoing server hosting costs and upkeep.
2. **Privacy Concerns & Data Tracking**: Centralized third-party download servers capture, log, and inspect every URL a user copies or downloads.
3. **Fragmented Workflows**: Downloading a video on mobile requires copying links to messaging apps or emailing yourself to open on desktop.

### The ClipGrab Solution

**ClipGrab** solves this by pioneering a **BYOD (Bring Your Own Database)** serverless architecture.

- **Zero Third-Party API Servers**: All clients (Desktop, Mobile, Extension) communicate directly with your private **Neon Postgres** database over the **Neon HTTP API** (`@neondatabase/serverless`).
- **Unified Master Command Center**: Your Mac/PC (`apps/desktop`) acts as the Master Command Center. It displays a QR Code to pair Mobile & Extension targets instantly.
- **Local Native Downloading**: Mobile and Extension clients **never** waste bandwidth downloading large media files. They simply push URL tasks to your serverless Neon `media_queue` table. Your Desktop Command Center continuously polls the database and executes native high-performance downloads locally via `yt-dlp`, `ffmpeg`, and `gallery-dl`.
- **Private Media History Vault**: Archive completed or cleared jobs into a Neon-backed `media_history` vault table with batch tracking, restoration, and TXT export capabilities.

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
│ (Rust + React + CLI)   ├────────────────────┘ Poll & Update
└───────────┬────────────┘ Status
            │
            ├──► yt-dlp / ffmpeg / gallery-dl (Local Native Downloading)
            ├──► Eagle App Integration (Direct Asset Library Sync)
            └──► Media History Vault (Neon DB Persistence & Restoration)
```

### Stack Breakdown

- **Monorepo Tooling**: [Turborepo](https://turbo.build/) + [pnpm Workspaces](https://pnpm.io/)
- **Master Command Center**: [Tauri v2](https://tauri.app/) (Rust Backend) + React (TypeScript) + Tailwind CSS
- **Mobile Client**: [Expo](https://expo.dev/) (React Native) + `expo-camera` (QR Scanning) + `expo-secure-store`
- **WebExtension**: Manifest V3 + Vite + Chrome Storage API
- **Database & ORM**: [Neon Serverless Postgres](https://neon.tech/) via `@neondatabase/serverless` & [Drizzle ORM](https://orm.drizzle.team/) over HTTP
- **Engine Binaries**: `yt-dlp`, `ffmpeg`, `gallery-dl`

---

## 🔥 Key Features & Capabilities

### 🌐 Multi-Platform Downloader Engine
- **Supported Platforms**: YouTube (up to 4K), Twitter/X, TikTok, Instagram (Reels, Posts, Carousels, Photos, Stories), and Direct media links (`.mp4`, `.mp3`, `.mkv`, `.webm`, `.mov`).
- **URL Sanitation**: Automatically strips tracking parameters (`igsh`, `utm_source`, `utm_medium`, `si`, `s`, `t`, etc.) from incoming URLs.
- **Instagram Scraper & Fallbacks**: Integrated fallback mechanisms using embed scrapers and `gallery-dl` for multi-photo carousels and photo posts.

### 📦 History Vault & Workspace Archiving
- **Neon-Backed Archiving**: Workspace cleanup actions (`Clear Completed`, `Clear Entire Workspace`) archive job records to the `media_history` table.
- **Action Batch Tracking**: Keeps track of job action history (`CLEAR_WORKSPACE`, `CLEAR_COMPLETED`, `BULK_DELETE`, `SINGLE_DELETE`).
- **Vault Management Drawer**: Inspect past download batches, filter by batch or status, restore archived items back to the live workspace queue, or export history to plain text (`.txt`).

### 🦅 Eagle App Integration
- **Direct Asset Library Sync**: Sync downloaded media files and original source URLs directly into [Eagle](https://eagle.cool/) media asset manager.
- **Manual & Bulk Sync**: Supports 1-click single job sync as well as bulk multi-selection sync toolbar actions.

### 💻 Live Process Command Console
- **Real-Time Output Streaming**: Built-in modal console displaying live `stdout` and `stderr` process logs from `yt-dlp`, `ffmpeg`, and `gallery-dl`.
- **Process Controls**: Dedicated stop/cancel buttons to terminate running download processes cleanly.

### 🩺 Engine Binary Health & Auto-Updates
- **CLI Dependency Status**: Checks local installation and version status of core tools (`yt-dlp`, `ffmpeg`, `gallery-dl`).
- **On-Demand Auto-Updates**: One-click background updates via Homebrew (`brew upgrade`) or official binary self-updaters (`yt-dlp -U`).

### ⚙️ Granular Download Configurations
- **Quality & Format Controls**: Select video resolution (Best, 4K, 1080p, 720p, 480p) and target audio/video container format (MP4, MKV, WebM, MP3).
- **Apple & QuickTime Compatibility**: Optional strict FFmpeg recoding toggle (forces AVC/H.264 video and AAC audio encoding to ensure seamless playback on macOS QuickTime and iOS).
- **Cookie Authentication**: Auto-detect installed system browsers (Chrome, Safari, Firefox, Brave, Edge, Opera) or upload custom cookies `.txt` files to bypass paywalls and age-restricted links.

### 📋 Batch Import & Multi-Select Toolbar
- **Batch Import Modal**: Paste raw multiline text or upload `.json` / `.txt` files to import dozens of URLs at once with automatic deduplication.
- **Multi-Selection Actions**: Bulk select jobs to execute batch deletion, queue reset, Eagle sync, or vault archiving.

---

## 📁 Monorepo Workspace Structure

```
clipgrab/
├── apps/
│   ├── desktop/           # Tauri v2 + React Master Command Center & Settings UI
│   │   ├── src/           # React App, Downloader Engine, Modals, & Cyber Components
│   │   └── src-tauri/     # Rust Tauri app configuration, capabilities, & permissions
│   ├── extension/         # Manifest V3 WebExtension (Vite + React + Chrome Storage)
│   └── mobile/            # Expo React Native App (QR Scanner + Share Target + SecureStore)
├── packages/
│   ├── db/                # Drizzle ORM Schema, Neon HTTP API Client, Auto-Migrator
│   ├── core-downloader/   # RegEx platform detection rules, tracking stripper, & URL parsers
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
2. **Auto-Migration**: Tauri automatically provisions all required Drizzle schema tables (`media_queue`, `device_nodes`, `clipboards`, `user_configs`, `media_history`) directly over Neon HTTP API.
3. **QR Generation**: Tauri generates a secure `pass_id` UUID, packages `{ databaseUrl, passId, createdAt }` into a Base64 JSON payload, and renders a **QR Code**.
4. **Mobile Pairing**: Scan the Mac QR Code using the Expo Mobile App. Credentials are stored securely in `expo-secure-store`.
5. **Extension Pairing**: Copy the Base64 pairing string from the Mac UI into the Extension Popup to save to `chrome.storage.local`.

---

## 🚀 Getting Started & Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) `>= 20.0.0`
- [pnpm](https://pnpm.io/) `>= 9.0.0`
- [Rust & Cargo](https://www.rust-lang.org/) (for Tauri desktop app)
- `yt-dlp` and `ffmpeg` installed on your system (e.g. via `brew install yt-dlp ffmpeg gallery-dl`)

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
| [`@clipgrab/db`](./packages/db)                           | Drizzle ORM tables & `@neondatabase/serverless` client factory & migration runner       |
| [`@clipgrab/core-downloader`](./packages/core-downloader) | RegEx pattern detection, tracking parameter stripper, & batch URL parsers               |
| [`@clipgrab/ui`](./packages/ui)                           | Shared React component library (`Button`, `Card`, `QRCodeView`, `StatusBadge`, `Input`) |
| [`@clipgrab/types`](./packages/types)                     | Centralized TypeScript interfaces (`MediaJob`, `DeviceNode`, `PairingPayload`, etc.)    |

---

## 📄 License

MIT License © 2026 ClipGrab
