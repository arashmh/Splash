interface XRGPUSubImage extends XRSubImage {
  readonly colorTexture: GPUTexture;
  readonly depthStencilTexture: GPUTexture | null;
  getViewDescriptor(): GPUTextureViewDescriptor;
  readonly viewport: XRViewport;
}

interface XRViewport { x: number; y: number; width: number; height: number }
interface XRView { eye: 'left' | 'right' | 'none'; projectionMatrix: Float32Array; transform: { inverse: { matrix: Float32Array } } }
interface XRFrame { getViewerPose(space: XRReferenceSpace): { views: XRView[] } | null; getPose(space: XRSpace, baseSpace: XRReferenceSpace): XRGripPose | null }
interface XRReferenceSpace { getOffsetReferenceSpace(transform: XRRigidTransform): XRReferenceSpace }
interface XRSpace {}
interface XRRigidTransform { new (init?: { x?: number; y?: number; z?: number }): XRRigidTransform }
interface XRGripPose { transform: { position: { x: number; y: number; z: number }; matrix: Float32Array } }
interface XRInputSource { handedness: string; gamepad?: Gamepad; gripSpace?: XRSpace; targetRaySpace?: XRSpace }
interface XRSession { updateRenderState(state: { layers: XRProjectionLayer[] }): void; requestReferenceSpace(type: string): Promise<XRReferenceSpace>; requestAnimationFrame(cb: (time: number, frame: XRFrame) => void): number; inputSources: XRInputSource[]; addEventListener(type: string, cb: () => void): void }
interface XRSystem { isSessionSupported?(mode: string): Promise<boolean>; requestSession(mode: string, init?: XRSessionInit): Promise<XRSession> }
interface XRSubImage {}
interface XRProjectionLayer {}

interface XRGPUBinding {
  new (session: XRSession, device: GPUDevice): XRGPUBinding;
  getPreferredColorFormat(): GPUTextureFormat;
  createProjectionLayer(init?: {
    colorFormat?: GPUTextureFormat;
    depthStencilFormat?: GPUTextureFormat;
    scaleFactor?: number;
  }): XRProjectionLayer;
  getViewSubImage(layer: XRProjectionLayer, view: XRView): XRGPUSubImage;
}

interface GPURequestAdapterOptions {
  xrCompatible?: boolean;
}

interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
}
