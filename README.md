# SAATIRIL

**Sistem Auto Track Input, Raw into Live**

Aplikasi desktop Windows untuk tracking foto wisuda secara real-time melalui jaringan LAN lokal.

---

## Tentang SAATIRIL

SAATIRIL adalah sistem yang mengkoordinasikan proses foto wisuda antara **Admin**, **MC**, dan **Operator Kamera** secara real-time menggunakan Socket.io melalui jaringan LAN. Dirancang untuk stabilitas sepanjang acara wisuda dengan ribuan peserta.

### 3 Role Pengguna

| Role | Fungsi | Akses |
|------|--------|-------|
| **Admin** | Mengelola proyek, peserta, dan memanggil peserta | Dashboard lengkap, monitor MC & Operator |
| **MC** | Memanggil peserta ke panggung | Panel MC, kontrol pemanggilan |
| **Operator** | Mengambil foto peserta (Toga + Ijazah) | Panel Operator, akses webcam |

### Alur Kerja

```
Admin memanggil peserta → MC mengumumkan → Operator mengambil 2 foto (Toga + Ijazah) → MC lanjut ke peserta berikutnya
```

---

## Struktur Proyek

```
saatiril/
├── electron/                    # Electron wrapper (Desktop App)
│   ├── main.js                  # Main process — Socket.io server + custom protocol
│   └── preload.js               # Preload script (context bridge)
│
├── src/                         # Next.js 16 Frontend
│   ├── app/
│   │   ├── page.tsx             # Entry point — router berdasarkan role
│   │   ├── layout.tsx           # Root layout
│   │   ├── globals.css          # Global styles (dark purple + gold theme)
│   │   └── error.tsx            # Error boundary
│   ├── components/
│   │   ├── saatiril/            # Komponen utama SAATIRIL
│   │   │   ├── main-app.tsx     # Main app container + tab navigation
│   │   │   ├── project-hub.tsx  # Project selection hub
│   │   │   ├── project-setup.tsx # Project creation + import peserta
│   │   │   ├── admin-dashboard.tsx # Admin: manajemen peserta + monitor
│   │   │   ├── mc-panel.tsx     # MC: pemanggilan peserta + status foto
│   │   │   └── operator-panel.tsx # Operator: webcam + capture foto
│   │   └── ui/                  # shadcn/ui components
│   ├── lib/
│   │   ├── socket.ts            # Socket.io client + reconnection handling
│   │   ├── db.ts                # Prisma database client
│   │   └── utils.ts             # Utility functions
│   ├── hooks/                   # Custom React hooks
│   └── store/
│       └── use-saatiril-store.ts # Zustand state management
│
├── mini-services/
│   └── saatiril-socket/         # Socket.io relay server (dev mode)
│       ├── index.ts             # Production-grade Socket.io server
│       └── package.json
│
├── prisma/
│   └── schema.prisma            # Database schema (SQLite)
│
├── electron-builder.yml         # Electron build config (Windows NSIS)
├── next.config.ts               # Next.js config (static export)
├── Caddyfile                    # Gateway routing (dev mode)
└── package.json
```

---

## Tech Stack

| Teknologi | Kegunaan |
|-----------|----------|
| **Next.js 16** | Frontend framework (App Router, static export) |
| **TypeScript** | Type safety |
| **Tailwind CSS 4** | Styling |
| **shadcn/ui** | UI component library |
| **Zustand** | State management |
| **Socket.io** | Real-time komunikasi LAN |
| **Electron** | Desktop wrapper (Windows) |
| **Prisma + SQLite** | Database lokal |
| **Framer Motion** | Animasi |

---

## Cara Menjalankan

### Development Mode (Web Browser)

```bash
# Install dependencies
bun install

# Start Next.js dev server
bun run dev

# Start Socket.io server (terminal terpisah)
cd mini-services/saatiril-socket
bun install
bun run dev
```

Buka browser di `http://localhost:3000`. Perangkat lain di LAN bisa mengakses via IP address komputer host.

### Electron Desktop Mode

```bash
# Install dependencies
bun install

# Build Next.js static export
bun run build

# Run as Electron app
bun run electron:dev
```

### Build Windows Installer (.exe)

```bash
bun run electron:dist
```

Installer akan ada di folder `dist-electron/`.

---

## Jaringan LAN

SAATIRIL dirancang untuk berjalan di jaringan LAN lokal tanpa internet:

- **Host (Admin)**: Menjalankan aplikasi utama + Socket.io server
- **MC & Operator**: Mengakses via browser di `http://<IP_HOST>:3000`
- Socket.io berjalan di port 3003 (auto-detect di Electron mode)
- Setiap role mendapat URL unik dengan parameter `?role=mc` atau `?role=operator`

---

## Keamanan & Stabilitas

- Socket.io mendukung **auto-reconnect** dengan exponential backoff
- **Connection state recovery**: jika disconnect < 2 menit, event yang terlewat otomatis dikirim ulang
- **Uncaught exception handler**: aplikasi tetap berjalan meski ada error tak terduga
- **Heartbeat**: ping setiap 15 detik, timeout 30 detik
- **Max payload**: 20MB (mendukung burst foto dual-channel)
- **Max connections**: 10 client (cukup untuk admin + 2 MC + 2 Operator + buffer)

---

## Lisensi

MIT License — Copyright © 2025 SAATIRIL Team
