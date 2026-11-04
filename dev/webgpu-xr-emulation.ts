// Compatibility adapter for Splash's projection-layer API in IWER 2.x.
// Rendering stays on WebGPU; WebGL only presents the canvas to IWER.
// This is injected by Vite development tooling, never the production build.
export function installWebGPUXREmulation() {
  const host = window as any
  const timer = window.setInterval(() => {
    // IWER spoofs the Quest user agent, so detect the installed emulator rather
    // than using OculusBrowser in navigator.userAgent to distinguish devices.
    if (!host.IWER_DEVICE || host.__IWSDK_EMULATION_PROFILE?.runtime !== 'IWER' || !navigator.xr) return
    clearInterval(timer)
    // IWER installs its globals asynchronously and replaces native XR globals.
    // Check for an existing binding only after that installation has finished.
    if (host.XRGPUBinding) return
    const xr = navigator.xr as any
    const request = xr.requestSession.bind(xr)
    const states = new WeakMap<object, any>()
    const nativeViews = new WeakMap<object, any>()
    xr.requestSession = async (mode: string, init: any = {}) => {
      if (!init.requiredFeatures?.includes('webgpu')) return request(mode, init)
      const session = await request(mode, {...init,
        requiredFeatures: init.requiredFeatures.filter((f: string) => f !== 'webgpu'),
        optionalFeatures: (init.optionalFeatures ?? []).filter((f: string) => f !== 'webgpu'),
      })
      const update = session.updateRenderState.bind(session)
      const raf = session.requestAnimationFrame.bind(session)
      const state: any = {session, update}
      states.set(session, state)
      session.updateRenderState = (options: any) => {
        if (options.layers) {
          if (options.layers.length !== 1 || options.layers[0] !== state.layer) throw Error('Emulator supports one projection layer')
          const {layers, ...rest} = options
          update({...rest, baseLayer: state.baseLayer})
        } else update(options)
      }
      session.requestAnimationFrame = (callback: any) => raf((time: number, frame: any) => {
        const wrapped = new Proxy(frame, {get(target, key) {
          if (key === 'getViewerPose') return (space: any) => {
            const pose = target.getViewerPose(space)
            if (!pose) return null
            const views = pose.views.map((view: any) => {
              const projection = new Float32Array(view.projectionMatrix)
              // IWER supplies WebGL clip depth; our emulated WebGPU session must
              // supply [0,1], exactly as a native WebGPU XR session does.
              for (let c=0;c<4;c++) projection[c*4+2]=(projection[c*4+2]+projection[c*4+3])/2
              const wrappedView = new Proxy(view, {get(v,k) {return k === 'projectionMatrix' ? projection : Reflect.get(v,k,v)}})
              nativeViews.set(wrappedView, view)
              return wrappedView
            })
            return new Proxy(pose,{get(p,k) {return k === 'views' ? views : Reflect.get(p,k,p)}})
          }
          const value=Reflect.get(target,key,target)
          return typeof value === 'function' ? value.bind(target) : value
        }})
        callback(time, wrapped)
        state.present?.()
      })
      session.addEventListener('end', () => {state.dispose?.(); states.delete(session)})
      return session
    }
    host.XRGPUBinding = class {
      state: any
      constructor(session: any, private device: GPUDevice) {
        this.state=states.get(session)
        if (!this.state) throw Error('Emulated binding requires an IWER WebGPU session')
      }
      getPreferredColorFormat() {return navigator.gpu.getPreferredCanvasFormat()}
      createProjectionLayer(init: any = {}) {
        const state=this.state
        const gpuCanvas=document.createElement('canvas'), glCanvas=document.createElement('canvas')
        gpuCanvas.width=glCanvas.width=1280; gpuCanvas.height=glCanvas.height=720
        const gpu=gpuCanvas.getContext('webgpu')!
        gpu.configure({device:this.device,format:init.colorFormat ?? this.getPreferredColorFormat(),alphaMode:'opaque'})
        const gl=glCanvas.getContext('webgl2',{alpha:false,antialias:false})!
        if (!gl) throw Error('WebGL2 is required for IWER presentation')
        const compile=(type:number,source:string)=>{
          const shader=gl.createShader(type)!;gl.shaderSource(shader,source);gl.compileShader(shader)
          if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader) ?? 'Presenter shader failed')
          return shader
        }
        const vs=compile(gl.VERTEX_SHADER,`#version 300 es
          out vec2 uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`)
        const fs=compile(gl.FRAGMENT_SHADER,`#version 300 es
          precision highp float;in vec2 uv;uniform sampler2D image;out vec4 color;void main(){color=texture(image,vec2(uv.x,1.-uv.y));}`)
        const program=gl.createProgram()!;gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program)
        if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) ?? 'Presenter link failed')
        const texture=gl.createTexture()!, vao=gl.createVertexArray()!
        gl.bindTexture(gl.TEXTURE_2D,texture)
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)
        state.baseLayer=new host.XRWebGLLayer(state.session,gl,{alpha:false,antialias:false})
        state.gpu=gpu
        state.gpuCanvas=gpuCanvas
        state.gl=gl
        state.layer={emulatedWebGPU:true}
        state.present=()=>{
          gl.bindFramebuffer(gl.FRAMEBUFFER,state.baseLayer.framebuffer)
          gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight)
          gl.useProgram(program);gl.bindVertexArray(vao);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture)
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,gpuCanvas)
          gl.drawArrays(gl.TRIANGLES,0,3)
        }
        state.dispose=()=>{gpu.unconfigure();gl.deleteTexture(texture);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);gl.deleteVertexArray(vao)}
        return state.layer
      }
      getViewSubImage(layer: any, view: any) {
        const state=this.state
        if (layer !== state.layer) throw Error('Unknown emulated projection layer')
        const vp=state.baseLayer.getViewport(nativeViews.get(view) ?? view)
        // IWER resizes its presentation canvas to the managed viewport.
        // The GPU atlas must follow that size before acquiring this frame.
        if (state.gpuCanvas.width !== state.gl.drawingBufferWidth || state.gpuCanvas.height !== state.gl.drawingBufferHeight) {
          state.gpuCanvas.width=state.gl.drawingBufferWidth
          state.gpuCanvas.height=state.gl.drawingBufferHeight
        }
        const texture=state.gpu.getCurrentTexture()
        // XR viewport is top-left in WebGPU, bottom-left in WebGL.
        return {colorTexture:texture,depthStencilTexture:null,
          viewport:{x:vp.x,y:texture.height-vp.y-vp.height,width:vp.width,height:vp.height},
          getViewDescriptor:()=>({dimension:'2d',baseArrayLayer:0,arrayLayerCount:1}),}
      }
    }
    console.info('[Splash] IWER WebGPU projection-layer compatibility adapter installed')
  }, 20)
  window.setTimeout(()=>{
    clearInterval(timer)
    if (!host.XRGPUBinding) console.warn('[Splash] WebGPU adapter unavailable', {iwer:!!host.IWER_DEVICE,xr:!!navigator.xr})
  },10000)
}
