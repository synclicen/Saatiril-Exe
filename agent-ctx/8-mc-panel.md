# Task 8 - MC Panel Component

## Summary
Created `/home/z/my-project/src/components/saatiril/mc-panel.tsx` - the MC (Master of Ceremonies) Panel Tab component for the SAATIRIL photography event management system.

## Implementation Details

### Component Structure
- **`McPanel`** - 'use client' React component with two main sections

### Top Section - Call Panel
- Gold-bordered Card showing "Target Pemanggilan Selanjutnya" (Next Call Target)
- Displays next student's name (large bold text) and NIM
- When a student is currently being photographed, shows "Sedang difoto" with that student's info
- "PANGGIL SEKARANG" button with three states:
  - **Photographing**: Disabled, shows spinner + "TUNGGU KAMERA..."
  - **Has next**: Enabled, gold button with Megaphone icon + "PANGGIL SEKARANG"
  - **Queue empty**: Disabled, shows "ANTREAN HABIS"

### Bottom Section - Queue List
- Header showing "Sisa Antrean: X" and current channel number
- Column headers: No, NIM, Nama Lengkap, Status
- Scrollable list of students filtered by `myChannel`
- Color-coded rows:
  - **Active** (being photographed): Gold-tinted background with gold left border and glow shadow
  - **Next pending**: Purple panel with gold left border
  - **Done**: Green-tinted with reduced opacity, name struck through
  - **Regular pending**: Purple panel with purple border
- Auto-scrolls to the active or next student

### Call Action Logic
When "PANGGIL SEKARANG" is clicked:
1. Finds the next pending student for the current channel
2. Updates their status to `active_${myChannel}`
3. Updates the current project in store
4. Saves to localStorage via `saveProjectsToStorage()`
5. Emits 'SYNC_DB' and 'MC_CALL' via socket

### Socket Integration
- Listens for 'SYNC_DB' events to trigger re-render
- Cleans up listener on unmount

### Theme
- Dark purple theme with gold accents using bracket notation for custom colors
- Background: #1a0b2e, Panels: #2a164a, Cards: #3b2263, Borders: #533485, Gold: #d4af37, Muted: #c4b5fd

### Dependencies Used
- shadcn/ui: Card, CardContent, Button, Badge, ScrollArea
- lucide-react: Megaphone, Users, Clock, CheckCircle2, Loader2
- Store: useSaatirilStore
- Socket: emitLocal, onLocal, offLocal

### Lint Status
✅ Passes `bun run lint` with no errors
