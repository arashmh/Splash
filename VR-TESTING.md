# Quest VR development

Run `npm run dev` for the IWSDK managed workspace. `npx iwsdk dev up --ai-mode agent`
selects a headless browser. Check `npx iwsdk runtime wait` for browser readiness.
Splash uses its own WebGPU simulation, not an IWSDK ECS World; native scene and
ECS inspection therefore do not describe this renderer.

Quest Browser 152.1 requires WebXR Experiments in chrome://flags for the
WebGPU XR binding. Restart the browser after changing flags. Open the HTTPS
network URL from `npx iwsdk dev status`, accept the development certificate,
and press Enter WebGPU VR. Startup errors and GPU validation errors are shown
on the page. The emulator does not prove physical WebGPU XR support.

- Left thumbstick: head-relative movement (1.4 metres/second).
- Right thumbstick: 30-degree snap turns, returning to centre between turns.
- Right controller: visible cyan 1.5-metre stick. Its full length applies a
  capsule-shaped force to nearby occupied fluid cells. Both rotating and moving
  the controller stir the fluid. The line is an overlay, visible through water.
- Lost tracking clears force; locomotion does not inject artificial force.
- The default pond is 4.8 metres wide (12.5 simulation units per metre).
- Ground is a world-space grid plane; the skybox ignores camera translation.

Checks: `npm test`, `npm run typecheck`, `npm run build`.
`node tests/browser-smoke.mjs` also reads back a shared stereo GPU attachment
after both eye draws in fluid and particle modes, checking that neither eye
clears or writes into the other's region. The XR test checks distinct asymmetric
projections and scaled 64mm eye separation. On 2026-11-04 these checks passed;
IWSDK initially returned target_not_ready for this custom renderer. The
development-only adapter in dev/iwsdk-bridge.ts supplies the runtime readiness
contract and delegates XR commands to IWER. XR status, device-state inspection,
and browser snapshots now succeed, including after reload. This does not add
native scene/ECS capabilities or prove physical Quest WebGPU XR support.

Stereo rendering uses separate per-eye uniforms and intermediate textures,
with each eye's native aspect ratio. Linear-depth reconstruction unprojects a
ray through the complete inverse projection. The browser GPU motion test checks
fixed world points with asymmetric projections, translation, yaw and roll.
The IWSDK emulator on this machine does not expose XRGPUBinding: its command
bridge works, but pressing Enter WebGPU VR cannot start this WebGPU session.
Do not report an emulated immersive test as passed without an active session.
Physical checks: enter/exit/re-enter VR, inspect both eyes, move/turn, stir with
the middle of the stick submerged, then stop moving and disconnect the right controller.
Confirm water continues simulating when the desktop page is not visible.

Setup verification on 2026-11-02: unit test, typecheck and production build
pass. No Quest was connected. Chromium installation succeeded after freeing
disk space. Browser smoke testing uses the locally available WebGPU-capable
Chromium via CHROMIUM_EXECUTABLE when the newer headless browser lacks an adapter.
