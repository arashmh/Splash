import { renderUniformsViews } from './camera'

export type XREyeRenderer = (view: XRView, target: GPUTextureView, viewport: XRViewport) => void

export const xrInput = {
  active: false,
  pointer: [0.5, 0.5] as number[],
  velocity: [0, 0, 0, 0] as number[],
  rayOrigin: [0, 1.2, 0] as number[],
  rayDirection: [0, 0, -1] as number[],
}

export async function startWebGPUXR(device: GPUDevice, renderEye: XREyeRenderer) {
  if (!navigator.xr || !navigator.gpu) {
    throw new Error('WebXR or WebGPU is not available in this browser.')
  }
  if (!('XRGPUBinding' in globalThis)) {
    throw new Error('XRGPUBinding is missing. In Quest Browser 152.1, enable "WebXR Experiments" at chrome://flags and restart the browser. WebGPU flags alone do not enable this binding.')
  }

  // Request directly from the button gesture, without an asynchronous probe
  // that can consume the transient user activation required for immersive VR.
  const session = await navigator.xr.requestSession('immersive-vr', {
    requiredFeatures: ['webgpu'],
    optionalFeatures: ['local-floor'],
  })
  const binding = new (globalThis as any).XRGPUBinding(session, device) as XRGPUBinding
  const layer = binding.createProjectionLayer({
    colorFormat: binding.getPreferredColorFormat(),
    scaleFactor: 0.8,
  })
  session.updateRenderState({ layers: [layer] })
  let referenceSpace = await session.requestReferenceSpace('local-floor')
    .catch(() => session.requestReferenceSpace('local'))
  let previousGrip: { x: number; y: number; z: number } | null = null
  xrInput.active = true
  session.addEventListener('end', () => { xrInput.active = false })

  const onFrame = (_time: number, frame: XRFrame) => {
    const pose = frame.getViewerPose(referenceSpace)
    if (pose) {
      for (const source of session.inputSources) {
        const axes = source.gamepad?.axes ?? []
        if (source.handedness === 'left' && axes.length >= 2) {
          const deadZone = 0.15
          const x = Math.abs(axes[0]) > deadZone ? axes[0] : 0
          const z = Math.abs(axes[1]) > deadZone ? axes[1] : 0
          referenceSpace = referenceSpace.getOffsetReferenceSpace(new (globalThis as any).XRRigidTransform({ x: -x * 0.025, z: -z * 0.025 }))
        }

        const targetRay = source.targetRaySpace && frame.getPose(source.targetRaySpace, referenceSpace)
        if (source.handedness === 'right' && targetRay) {
          const transform = targetRay.transform
          const p = transform.position
          const m = transform.matrix
          const dx = -m[8], dy = -m[9], dz = -m[10]
          xrInput.rayOrigin[0] = p.x; xrInput.rayOrigin[1] = p.y; xrInput.rayOrigin[2] = p.z
          xrInput.rayDirection[0] = dx; xrInput.rayDirection[1] = dy; xrInput.rayDirection[2] = dz
          const rayLength = Math.max(0.15, Math.min(2.5, (1.15 - p.y) / Math.max(0.05, -dy)))
          const hitX = p.x + dx * rayLength
          const hitY = p.y + dy * rayLength
          if (previousGrip) {
            xrInput.velocity[0] = (p.x - previousGrip.x) * 8
            xrInput.velocity[1] = (p.y - previousGrip.y) * 8
            xrInput.velocity[2] = 0
            xrInput.velocity[3] = 0
          }
          previousGrip = { x: p.x, y: p.y, z: p.z }
          xrInput.pointer[0] = Math.max(0, Math.min(1, 0.5 + hitX * 0.15))
          xrInput.pointer[1] = Math.max(0, Math.min(1, 0.5 - (hitY - 1.2) * 0.15))
        }
      }
      for (const view of pose.views) {
        const subImage = binding.getViewSubImage(layer, view)
        renderUniformsViews.projectionMatrix.set(view.projectionMatrix)
        renderUniformsViews.viewMatrix.set(view.transform.inverse.matrix)
        renderEye(view, subImage.colorTexture.createView(subImage.getViewDescriptor()), subImage.viewport)
      }
    }
    session.requestAnimationFrame(onFrame)
  }
  session.requestAnimationFrame(onFrame)
  return session
}
