import { mat4 } from 'wgpu-matrix'
import { renderUniformsViews } from '../camera'
import { xrInput } from '../xr'

export class XRStick {
  buffer: GPUBuffer
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  values = new Float32Array(24)
  constructor(private device: GPUDevice, format: GPUTextureFormat) {
    this.buffer = device.createBuffer({size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST})
    const module = device.createShaderModule({code: `
      struct Data { matrix: mat4x4f, origin: vec4f, tip: vec4f }
      @group(0) @binding(0) var<uniform> data: Data;
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        return data.matrix * vec4f(select(data.origin.xyz, data.tip.xyz, i == 1u), 1.0);
      }
      @fragment fn fs() -> @location(0) vec4f { return vec4f(0.1, 1.0, 0.8, 1.0); }
    `})
    this.pipeline = device.createRenderPipeline({layout:'auto', vertex:{module}, fragment:{module,targets:[{format}]}, primitive:{topology:'line-list'}})
    this.group = device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0), entries:[{binding:0,resource:{buffer:this.buffer}}]})
  }
  draw(encoder: GPUCommandEncoder, target: GPUTextureView, viewport: XRViewport) {
    if (!xrInput.tracked) return
    this.values.set(mat4.multiply(renderUniformsViews.projectionMatrix, renderUniformsViews.viewMatrix))
    this.values.set(xrInput.origin,16); this.values.set(xrInput.position,20)
    this.device.queue.writeBuffer(this.buffer,0,this.values)
    const pass = encoder.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]})
    pass.setViewport(viewport.x,viewport.y,viewport.width,viewport.height,0,1)
    pass.setPipeline(this.pipeline); pass.setBindGroup(0,this.group); pass.draw(2); pass.end()
  }
}
