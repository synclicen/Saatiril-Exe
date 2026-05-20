---
Task ID: 1
Agent: Main
Task: Fix layout fullscreen + photo saving issues in SAATIRIL

Work Log:
- Analyzed the full codebase to identify two user-reported issues
- Issue 1: Layout didn't span fullscreen — components used min-h-screen causing scroll instead of filling viewport
- Issue 2: Photos captured by operator didn't show in admin dashboard — PHOTOS_SAVED event data shape mismatch
- Fixed layout.tsx: Added h-screen overflow-hidden to body, wrapped children in h-full flex flex-col
- Fixed page.tsx: Added h-full flex-1 flex flex-col overflow-hidden wrapper
- Fixed main-app.tsx: Changed to h-full flex layout, main content uses flex-1 min-h-0 overflow-hidden, header shrink-0, footer shrink-0
- Fixed project-hub.tsx: Changed min-h-screen to h-full
- Fixed project-setup.tsx: Changed min-h-screen to h-full
- Fixed operator-panel.tsx: Full height layout, aspect ratio camera viewport, frame overlay preview on camera, preloaded frame image for capture, frame indicator badge
- Fixed admin-dashboard.tsx: Full height layout with overflow, fixed PHOTOS_SAVED handler to accept { student, photos, channel } instead of { historyItem }, photo thumbnails now show actual captured images
- Fixed mc-panel.tsx: Full height layout
- Fixed lint errors: camera initialization uses queueMicrotask to avoid synchronous setState in effect

Stage Summary:
- All layouts now fill viewport height properly with h-full and flex
- Camera viewport respects the selected aspect ratio (4:3, 16:9, 3:4)
- Frame overlay is now visible on the camera preview as a live overlay
- PHOTOS_SAVED event data shape fixed: operator sends { student, photos, channel }, admin builds PhotoHistoryItem from it
- Admin dashboard now shows actual captured photo thumbnails instead of placeholder icons
- Lint passes cleanly
