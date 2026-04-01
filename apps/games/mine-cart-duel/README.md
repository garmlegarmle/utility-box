# Mine Cart Duel

Local browser duel prototype built with `Vite + vanilla JS + MediaPipe Hand Landmarker`.

The player aims with webcam hand tracking, fights a CPU opponent on a parallel mine cart track, and wins by landing 5 body hits first.

## Files

- `index.html`: app shell, bottom duel HUD, settings panel, webcam preview, start overlay with guide images
- `main.js`: webcam bootstrap, mode select lobby flow, CPU difficulty flow, multiplayer placeholder matching flow, HUD wiring, input bridging, duel loop
- `handTracking.js`: webcam tracking, fingertip aiming, thumb-fold shooting, reload gesture, debug-safe smoothing
- `game.js`: local duel state machine, hit rules, player/CPU ammo, countdown, win/loss flow
- `opponentController.js`: CPU telegraph, cadence, reload behavior, aim pressure
- `sceneMath.js`: shared scene geometry and enemy hitbox math
- `sketchRenderer.js`: pencil-sketch scene rendering, enemy cart, first-person weapon, impact effects, health bars, overlays
- `soundEffects.js`: real `wav` gunshot, reload, and random hurt voice playback
- `style.css`: paper-tone UI and overlay styling

## Run

```bash
cd "/Users/gamlebae/Desktop/game test/hand-shooter-mvp"
npm install
npm run dev
```

Open the localhost URL printed by Vite.

## Start Flow

- Choose `컴퓨터와 대결` or `다른 참가자와 대결`
- CPU mode: pick difficulty, review the tutorial, click `Start Game`
- Multiplayer preview: review the tutorial, click `Start Game`, then watch the mock matching flow
- The browser asks for webcam permission only when `Start Game` is pressed
- CPU mode starts the duel countdown right away after permission succeeds
- Multiplayer mode currently shows the lobby / matching sequence first, then auto-enters the duel scene as a placeholder preview

## Controls

- Aim: hold a finger-gun pose so the mirrored fingertip drives the crosshair
- Shoot: fold the thumb in while holding the gun pose
- Reload: sweep the support hand over the thumb side of the aim hand to rack reload
- Debug shoot: `Space`
- Debug reload: `R`
- Restart duel: `Enter` or `Restart Duel`

## Game Rules

- First to `5` body hits wins.
- Only the enemy rider silhouette counts as a hit.
- The enemy cart, tracks, and scenery are not valid targets.
- Both the player and CPU use a `6-shot` magazine.
- Both sides must reload before shooting again when empty.
- Reload completes when the reload sound finishes.
- The CPU attacks using telegraph + cooldown + accuracy logic, not a real raycast aiming system.
- Enemy health is shown above the enemy head, and player health is shown at the bottom.
- When the cylinder is empty, a center-screen `재장전 / Reload` prompt appears.
- While either side is reloading, `장전중 / Reloading` status text is shown.

## Visual Direction

- Bright paper-like desert background
- Pencil sketch rails, mine carts, and rider silhouettes
- First-person drawn revolver/hand in the foreground
- Limited accent colors only for muzzle flash, hit feedback, and win/loss emphasis

## Known Limitations

- This is still a prototype and uses best-effort hand tracking.
- Lighting and fingertip visibility still affect aim quality.
- The CPU hit model is timing/accuracy based because the player has no movement or dodge system yet.
- MediaPipe assets are still fetched remotely, so the first load requires network access.
- Sound effects rely on local `wav` files inside `public/sfx`, so replacing them is the fastest way to retune feel.
- The multiplayer path is still a UI preview only. There is no real networked opponent, syncing, or backend matchmaking yet.

## Web Service Prep

- `Frontend state flow`
  Mode select, CPU difficulty select, tutorial, and multiplayer matching are now separated in the start overlay. This can map directly to route-like UI states in a hosted service.
- `Static assets`
  Background art, guide images, and sound files already live under `public/art`, `public/ui`, and `public/sfx`, which is suitable for CDN/static hosting.
- `Realtime multiplayer work still needed`
  Add player identity, lobby creation or queue matchmaking, match acceptance, room join, disconnect handling, and authoritative game state sync.
- `Networking`
  A hosted version will need either WebSocket rooms or WebRTC plus a signaling service for low-latency duel state.
- `Camera permission UX`
  Keep camera permission tied to the final `Start Game` click in production too, so browsers allow it reliably on user gesture.
- `Matchmaking placeholder to replace`
  The current multiplayer flow only simulates search and match found timing before entering the existing duel scene. This should be replaced with real backend-driven matchmaking events.

## Troubleshooting

- Run from `localhost` through Vite. Opening the HTML file directly will not work.
- Chrome or Edge is the safest choice for webcam + MediaPipe.
- If the webcam preview stays off, check browser camera permissions and whether another app is using the camera.
- Aim now uses direct fingertip mapping without startup calibration.
- If MediaPipe fails to load, refresh and verify that your network connection is available.
