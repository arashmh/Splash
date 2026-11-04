import { mat4 } from 'wgpu-matrix'
import { renderUniformsViews } from './camera'

const UNITS_PER_METRE = 12.5
export const xrInput = { active: false, tracked: false, position: [0,0,0,0], velocity: [0,0,0,0], origin: [0,0,0,0], originVelocity: [0,0,0,0] }

export async function startWebGPUXR(device: GPUDevice, format: GPUTextureFormat,
  renderEye: (view: XRView, target: GPUTextureView, viewport: XRViewport) => void,
  step: () => void, box: () => number[]) {
  if (!navigator.xr || !navigator.gpu) throw new Error('WebXR/WebGPU requires a supported browser and HTTPS.')
  if (!('XRGPUBinding' in globalThis)) throw new Error('XRGPUBinding is missing. Enable WebXR Experiments in chrome://flags and restart Quest Browser.')
  const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['webgpu'], optionalFeatures: ['local-floor'] })
  try {
    const binding = new (globalThis as any).XRGPUBinding(session, device) as XRGPUBinding
    const layer = binding.createProjectionLayer({ colorFormat: format, scaleFactor: 0.8 })
    session.updateRenderState({ layers: [layer] })
    let seated = false
    const space = await session.requestReferenceSpace('local-floor').catch(() => { seated = true; return session.requestReferenceSpace('local') })
    const size = box(), offset = [size[0]/2, seated ? 1.6 * UNITS_PER_METRE : 0, size[2]+1.2 * UNITS_PER_METRE]
    let previousOrigin: number[] | null = null
    let last = 0, previous: number[] | null = null, yaw = 0, turnReady = true
    xrInput.active = true
    session.addEventListener('end', () => { xrInput.active = false; xrInput.tracked = false; xrInput.velocity.fill(0) })
    const onFrame = (time: number, frame: XRFrame) => {
      session.requestAnimationFrame(onFrame)
      const dt = last ? Math.min((time-last)/1000, 0.05) : 0
      last = time
      const pose = frame.getViewerPose(space)
      xrInput.tracked = false; xrInput.velocity.fill(0); xrInput.originVelocity.fill(0)
      if (!pose) { previous = null; previousOrigin = null; return }
      let moved = false
      for (const source of session.inputSources) {
        const axes = source.gamepad?.axes ?? []
        const ax = axes.length >= 4 ? axes[2] : axes[0] ?? 0
        const az = axes.length >= 4 ? axes[3] : axes[1] ?? 0
        if (source.handedness === 'right') {
          if (Math.abs(ax) < 0.3) turnReady = true
          if (Math.abs(ax) > 0.7 && turnReady) { yaw -= Math.sign(ax)*Math.PI/6; turnReady = false; moved = true }
        }
        if (source.handedness === 'left') {
          const x = Math.abs(ax)>0.15 ? ax : 0, z = Math.abs(az)>0.15 ? az : 0
          const head = mat4.inverse(pose.views[0].transform.inverse.matrix)
          const angle = yaw + Math.atan2(head[8], head[10]), norm = Math.max(1, Math.hypot(x,z))
          offset[0] += (Math.cos(angle)*x + Math.sin(angle)*z)/norm*dt*1.4*UNITS_PER_METRE
          offset[2] += (-Math.sin(angle)*x + Math.cos(angle)*z)/norm*dt*1.4*UNITS_PER_METRE
          moved ||= x !== 0 || z !== 0
        }
      }
      // Larger physical pond without increasing simulation work.
      const rig = mat4.translation(offset)
      mat4.rotateY(rig, yaw, rig); mat4.scale(rig, [UNITS_PER_METRE,UNITS_PER_METRE,UNITS_PER_METRE], rig)
      for (const source of session.inputSources) {
        if (source.handedness !== 'right' || !source.targetRaySpace) continue
        const ray = frame.getPose(source.targetRaySpace, space)
        if (!ray) continue
        const world = mat4.multiply(rig, ray.transform.matrix)
        for (let i=0; i<3; i++) {
          xrInput.origin[i] = world[12+i]
          xrInput.originVelocity[i] = previousOrigin && !moved && dt>0 ? Math.max(-4, Math.min(4, (xrInput.origin[i]-previousOrigin[i])/dt/72)) : 0
          xrInput.position[i] = world[12+i] - world[8+i]*1.5
          xrInput.velocity[i] = previous && !moved && dt>0 ? Math.max(-4, Math.min(4, (xrInput.position[i]-previous[i])/dt/72)) : 0
        }
        xrInput.tracked = true
      }
      previous = xrInput.tracked ? xrInput.position.slice() : null
      previousOrigin = xrInput.tracked ? xrInput.origin.slice() : null
      step()
      for (const view of pose.views) {
        const sub = binding.getViewSubImage(layer, view)
        if (sub.viewport.width <= 0 || sub.viewport.height <= 0) continue
        const projection = new Float32Array(view.projectionMatrix)
        // A session with the webgpu feature already supplies [0,1] clip depth.
        renderUniformsViews.projectionMatrix.set(projection)
        renderUniformsViews.invProjectionMatrix.set(mat4.inverse(projection))
        const world = mat4.multiply(rig, mat4.inverse(view.transform.inverse.matrix))
        // Keep the camera basis rigid. Only physical translations are scaled
        // into simulation units; particle radii and filter depth use those same
        // units. A scaled camera basis makes every particle 25x too large.
        for (let column = 0; column < 3; column++) {
          for (let row = 0; row < 3; row++) world[column * 4 + row] /= UNITS_PER_METRE
        }
        renderUniformsViews.invViewMatrix.set(world)
        renderUniformsViews.viewMatrix.set(mat4.inverse(world))
        renderEye(view, sub.colorTexture.createView(sub.getViewDescriptor()), sub.viewport)
      }
    }
    session.requestAnimationFrame(onFrame)
    return session
  } catch (error) { await session.end().catch(() => {}); throw error }
}
