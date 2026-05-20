# Task 7 - Admin Dashboard Component

## Summary
Created `/home/z/my-project/src/components/saatiril/admin-dashboard.tsx` — the Admin Dashboard Tab for the SAATIRIL photography event management system.

## What was built
A `'use client'` React component with a dark purple theme (`#1a0b2e` / `#2a164a` / `#3b2263`) and gold accents (`#d4af37`), featuring a responsive 2-column layout:

### Left Column (1/3 width):
1. **Status Panel** — Shows Total Peserta count and Selesai Difoto count (with green accent)
2. **Live Command Center** — Displays target name and camera status; in dual mode shows both Camera KIRI (Jalur 1, gold) and Camera KANAN (Jalur 2, cyan)
3. **LAN Access Distribution** — Copy link buttons for MC and Operator roles; in dual mode grouped into Jalur Kiri (gold) and Jalur Kanan (cyan) sections

### Right Column (2/3 width):
- **Log Render & Penyimpanan** — Photo gallery with scrollable grid, photo count badge, and empty state message

## Key implementation details:
- Uses `useSaatirilStore` for project data (database, photoHistory, config)
- Listens for `PHOTOS_SAVED`, `MC_CALL`, `OP_PROGRESS`, `SYNC_DB` socket events via `onLocal`/`offLocal`
- Copy link generates URL: `${window.location.origin}/?role=${role}&channel=${channel}` with clipboard fallback
- Filename format: `{nim}_{nama_sanitized}_1_Toga.jpg` and `_2_Ijazah.jpg`
- Computed `doneCount` from database where `status === 'done'`
- Uses `useToast` for copy link notifications
- Fully responsive (stacks columns on mobile via `md:flex-row`)
- Lint passes with zero errors
