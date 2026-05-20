# Task 9 - Operator Camera Panel

## Summary
Created `/home/z/my-project/src/components/saatiril/operator-panel.tsx` — the most complex component in the SAATIRIL photography event management system.

## Component Architecture

### Layout
- **2-column responsive layout**: Left column (2/3 width) for camera area, Right column (1/3 width) for queue list
- Uses `lg:flex-row` for desktop and `flex-col` for mobile

### Left Column — Camera Area
1. **Target Info Panel**: Shows current target (avatar, name, NIM), camera source dropdown, and photo progress badge. Opacity 50% when no target, 100% when active. Gold border when active target.

2. **Camera Viewport**: Black rounded container with:
   - `<video>` element for webcam feed (autoplay, playsInline, muted)
   - Aspect ratio from project config applied to video and wrapper
   - CSS filter from project preset (original/studio/cinematic)
   - 3x3 rule-of-thirds grid overlay with subtle white lines
   - Flash overlay div for camera flash animation (0.85 opacity white, 300ms duration)
   - "NO CAMERA SIGNAL" overlay when camera unavailable
   - Hidden `<canvas>` element for photo capture

3. **Capture Button**: 4 states:
   - STANDBY (disabled, purple) — no active target
   - "1. JEPRET (TOGA)" (enabled, gold with glow) — ready for 1st photo
   - "2. JEPRET (IJAZAH)" (enabled, green with glow) — after 1st photo
   - "MENGIRIM..." (disabled, spinning) — after 2nd photo, sending

### Right Column — Queue List
- Same queue list as MC Panel but without call button
- Students filtered by myChannel with status coloring
- Auto-scrolls to active student

## Camera Logic
- On mount, requests camera access via `navigator.mediaDevices.getUserMedia({ video: true })`
- Enumerates video devices and populates camera dropdown
- When switching cameras, stops old tracks and requests new stream with deviceId
- Camera video is muted to prevent autoplay blocking
- Uses refs (streamRef, selectedDeviceRef) to avoid stale closure issues

## Photo Capture Logic
1. Trigger flash animation on overlay div
2. Draw current video frame to canvas (respecting aspect ratio — crop to fit target ratio)
3. Apply CSS filter from preset to canvas context via `ctx.filter`
4. If frame overlay exists, draw it on top of the photo using Image onload
5. Convert canvas to JPEG data URL (`canvas.toDataURL('image/jpeg', 0.95)`)
6. Add to opCapturedPhotos in store

After 1st photo:
- Emit 'OP_PROGRESS' with channel and status
- Capture phase auto-advances to 'ready-2' (computed from store state)

After 2nd photo:
- Set `sending` state, update capture phase to 'sending'
- Create PhotoHistoryItem
- Update student status to 'done'
- Emit 'PHOTOS_SAVED', then use setTimeout to:
  - Update project photoHistory
  - Emit 'SYNC_DB'
  - Reset operator state after 500ms delay

## Socket Listeners
- **MC_CALL**: When MC calls a student, set opCurrentTarget (filtered by myChannel)
- **SYNC_DB**: Update project data and check for active students to recover state

## State Recovery
- If there's an active student (status starts with 'active') when component mounts or SYNC_DB received, restore the operator target state via `recoverOperatorState()`

## Key Design Decisions
- `capturePhase` is computed via `useMemo` (not stored in state) — derived from `sending`, `hasActiveTarget`, and `opCapturedPhotos.length`
- Camera effects use `eslint-disable-line` for `react-hooks/set-state-in-effect` since camera initialization is a legitimate external system interaction
- `streamRef` and `selectedDeviceRef` used to avoid stale closure issues with async camera operations
- Canvas capture handles both ready (video.readyState >= 2) and not-ready states (draws "NO CAMERA SIGNAL" placeholder)
