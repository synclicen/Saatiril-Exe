# Task 6: Project Setup Component (Screen 2)

## Summary
Created `/home/z/my-project/src/components/saatiril/project-setup.tsx` — the SAATIRIL Project Setup/Creation screen.

## What was built
- **Dark purple theme** with gold (#d4af37) accents using Tailwind bracket notation
- **2-column responsive layout** (lg:grid-cols-2)
- **Left column**:
  - Project Name input with purple-card styling
  - Camera Mode select (Single: 1 MC + 1 Kamera, Dual: 2 MC + 2 Kamera Bersamaan)
  - Excel Upload section — single mode shows one drop zone; dual mode shows two zones (JALUR KIRI with gold accent, JALUR KANAN with cyan accent)
  - XLSX parsing: auto-detects NIM/NIS/ID and Nama/Name columns
  - Shows "Data siap: X Peserta Terbaca" status badge after successful upload
  - Clear/remove button for uploaded data
- **Right column**:
  - Photo Ratio select (4:3, 16:9, 3:4 Portrait)
  - Filter Preset select (Original Sensor, Studio Bright, Cinematic Gold)
  - Frame Overlay upload (.PNG) with drag-and-drop, base64 DataURL preview
  - Target Folder read-only input (defaults to C:\SAATIRIL_System_Out) with Browse button showing toast
- **Footer**:
  - Validation status text (changes based on form completion)
  - "MULAI SISTEM SAATIRIL" button — disabled until name + data ready
  - On submit: creates Project with unique ID, students with `ID_timestamp_random` format, calls addProject/setCurrentProject/setCurrentScreen('app'), saves to localStorage, emits SYNC_DB via socket

## Key integrations
- `useSaatirilStore` — Zustand store for project state
- `emitLocal` from `@/lib/socket` — LAN sync
- `useToast` — notifications
- `xlsx` library — Excel file parsing
- shadcn/ui: Card, Button, Input, Label, Select, Badge

## Lint
Clean — 0 errors, 0 warnings.
