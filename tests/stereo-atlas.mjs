// Run inside the browser: exercise FluidRenderer's actual output descriptors
// against a shared stereo atlas, then read back both eyes from the GPU.
export async function checkStereoAtlas(page) {
  await page.evaluate(async () => {
    const {FluidRenderer} = await import('/render/fluidRender.ts')
    const adapter = await navigator.gpu.requestAdapter(), device = await adapter.requestDevice()
    device.pushErrorScope('validation')
    const texture = device.createTexture({size:[16,8],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC})
    const target = texture.createView()
    const module = device.createShaderModule({code:`
      override right: bool = false;
      @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
        let p=array(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i%3],0,1);
      }
      @fragment fn fs()->@location(0) vec4f {return select(vec4f(1,0,0,1),vec4f(0,1,0,1),right);}
    `})
    const pipelines=[false,true].map(right=>device.createRenderPipeline({layout:'auto',vertex:{module},fragment:{module,constants:{right:Number(right)},targets:[{format:'rgba8unorm'}]}}))
    for (const particles of [false,true]) {
      const init=device.createCommandEncoder()
      init.beginRenderPass({colorAttachments:[{view:target,loadOp:'clear',storeOp:'store',clearValue:[0,0,1,1]}]}).end()
      device.queue.submit([init.finish()])
      for(let eye=0;eye<2;eye++) {
        const encoder=device.createCommandEncoder()
        const fakeDevice={queue:{writeBuffer(){}}}
        const renderer=new Proxy({device:fakeDevice},{get(object,key){return key in object ? object[key] : key}})
        const recorder={beginRenderPass(descriptor){
          const output=descriptor.colorAttachments[0].view===target
          const pass=output ? encoder.beginRenderPass(descriptor) : null
          return {
            setPipeline(){pass?.setPipeline(pipelines[eye])},setBindGroup(){},
            setViewport(...args){pass?.setViewport(...args)},setScissorRect(...args){pass?.setScissorRect(...args)},
            draw(...args){pass?.draw(...args)},end(){pass?.end()},
          }
        }}
        FluidRenderer.prototype.execute.call(renderer,null,recorder,0,particles,[1,1,1],1,target,{x:eye*8,y:0,width:8,height:8})
        device.queue.submit([encoder.finish()])
      }
      const read=device.createBuffer({size:256*8,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})
      const encoder=device.createCommandEncoder()
      encoder.copyTextureToBuffer({texture},{buffer:read,bytesPerRow:256},[16,8])
      device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ)
      const bytes=new Uint8Array(read.getMappedRange())
      for(let y=0;y<8;y++) for(let x=0;x<16;x++) {
        const pixel=Array.from(bytes.slice(y*256+x*4,y*256+x*4+4))
        const expected=x<8 ? [255,0,0,255] : [0,255,0,255]
        if(pixel.some((v,i)=>v!==expected[i])) throw new Error(`Stereo atlas overwritten (${particles},${x},${y}): ${pixel}`)
      }
      read.unmap(); read.destroy()
    }
    const error=await device.popErrorScope(); device.destroy()
    if(error) throw new Error(error.message)
  })
}
