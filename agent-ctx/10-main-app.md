# Task 10 - Main App Container

## Agent: main-app-agent

## Summary
Created `/home/z/my-project/src/components/saatiril/main-app.tsx` — the Main App Container component for the SAATIRIL photography event management system.

## Component Details

### File: `src/components/saatiril/main-app.tsx`
- **Type**: `'use client'` React component
- **Export**: Named `MainApp` and default export

### Features Implemented

1. **Header Section**:
   - Back button (ArrowLeft icon) that navigates to hub via `setCurrentScreen('hub')`
   - Project name display (truncated with `truncate` class)
   - Mode badge text: "Admin Control Center" / "Layar MC - Jalur X" / "Kamera - Jalur X" based on role
   - Tab navigation (admin role only) with 3 tabs: Admin Dashboard, Panel MC, Panel Operator
   - Active tab styled with gold background (#d4af37) and dark text
   - "Jalur Simulasi" dropdown (visible for admin in dual mode when MC/Operator tab selected)
   - Channel indicator badge (MC/Operator roles only)
   - Server status indicator with green/red dot and "LAN Server Aktif" text

2. **Main Content Area** (flex-1):
   - Renders active tab component based on `effectiveTab`
   - Fade-in + slide-up animation on tab switch using Tailwind `animate-in` classes
   - Uses `effectiveTab` as the React `key` to trigger re-mount animation

3. **Footer** (sticky to bottom via `mt-auto`):
   - "Saatiril - Made by Fajrianor - Pusat Humas dan Keterbukaan Informasi 2026"
   - Font: mono, size: 10px/xs, tracking-widest

### Role-based Behavior
- **Admin**: Sees all tabs, tab navigation visible, channel selector in dual mode
- **MC**: Automatically on MC tab, no tab navigation, channel indicator shown
- **Operator**: Automatically on Operator tab, no tab navigation, channel indicator shown

### URL Parameter Handling
- On mount, reads `role` and `channel` from URL search params
- Sets role and channel in Zustand store
- `isSynced` initialized via lazy state initializer checking URL params (avoids lint error)

### Socket Initialization
- Connects socket on mount via `connectSocket()`
- Listens for `connect`/`disconnect` events for server status indicator
- Uses `queueMicrotask` for initial connection check to avoid synchronous setState in effect
- Listens for `SYNC_DB` (non-admin receives project data; admin keeps own state in sync)
- Listens for `REQUEST_STATE` (admin responds by emitting `SYNC_DB` with current project)
- Non-admin clients emit `REQUEST_STATE` every 2 seconds until synced

### Sync Waiting Screen
- Shown for non-admin roles until project data received
- Displays spinner, "Sinkronisasi Data" title, and role/channel badge
- Dismissed automatically when `SYNC_DB` event received with project data

### Theme
- Dark purple theme with gold accents matching existing components
- Background: #1a0b2e, Panels: #2a164a, Cards: #3b2263, Borders: #533485, Gold: #d4af37, Muted: #c4b5fd, Cyan: #06b6d4

## Lint Status
- `main-app.tsx`: ✅ Clean (no lint errors)
- Unused imports (Monitor, Wifi, ChevronDown) removed

## Dependencies
- Uses existing store at `@/store/use-saatiril-store`
- Uses socket utility at `@/lib/socket`
- Imports `AdminDashboard`, `MCPanel`, `OperatorPanel` from sibling components
- Uses shadcn/ui: Button, Badge, Select (with SelectContent, SelectItem, SelectTrigger, SelectValue)
- Uses Lucide icons: ArrowLeft, Camera, LayoutDashboard, Megaphone, Radio, Loader2
