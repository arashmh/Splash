import { renderUniformsViews } from './camera'

export type XREyeRenderer = (view: XRView, target: GPUTextureView, viewport: XRViewport) => void

export const xrInput = {
  active: false,
  pointer: [0.5, 0.5] as number[],
  velocity: [0, 0, 0, 0] as number[],
}

export async function startWebGPUXR(device: GPUDevice, renderEye: XREyeRenderer) {
  if (!navigator.xr || !navigator.gpu || !('XRGPUBinding' in globalThis)) {
    throw new Error('This browser does not expose WebGPU WebXR (Quest currently falls back to desktop mode).')
  }

  const session = await navigator.xr.requestSession('immersive-vr', {
    requiredFeatures: ['webgpu', 'local-floor'],
  })
  const binding = new (globalThis as any).XRGPUBinding(session, device) as XRGPUBinding
  const layer = binding.createProjectionLayer({
    colorFormat: binding.getPreferredColorFormat(),
    scaleFactor: 0.8,
  })
  session.updateRenderState({ layers: [layer] })
  let referenceSpace = await session.requestReferenceSpace('local-floor')
  let locomotionX = 0
  let locomotionZ = 0
  let previousGrip: { x: number; y: number; z: number } | null = null
  xrInput.active = true
  session.addEventListener('end', () => { xrInput.active = false })

  const onFrame = (_time: number, frame: XRFrame) => {
    const pose = frame.getViewerPose(referenceSpace)
    if (pose) {
      for (const source of session.inputSources) {
        const axes = source.gamepad?.axes ?? []
        if (source.handedness === 'left' && axes.length >= 2) {
          locomotionX += axes[0] * 0.025
          locomotionZ += axes[1] * 0.025
          referenceSpace = referenceSpace.getOffsetReferenceSpace(new (globalThis as any).XRRigidTransform({ x: -axes[0] * 0.025, z: -axes[1] * 0.025 }))
        }
        const grip = source.gripSpace && frame.getPose(source.gripSpace, referenceSpace)
        if (source.handedness === 'right' && grip) {
          const p = grip.transform.position
          if (previousGrip) {
            xrInput.velocity[0] = (p.x - previousGrip.x) * 8
            xrInput.velocity[1] = (p.y - previousGrip.y) * 8
            xrInput.velocity[2] = 0
            xrInput.velocity[3] = 0
          }
          previousGrip = { x: p.x, y: p.y, z: p.z }
          xrInput.pointer[0] = Math.max(0, Math.min(1, 0.5 + p.x * 0.15))
          xrInput.pointer[1] = Math.max(0, Math.min(1, 0.5 - (p.y - 1.2) * 0.15))
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
