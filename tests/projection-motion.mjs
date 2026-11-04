// Validate the production WGSL reconstruction on the GPU, under moving,
// rotated heads and asymmetric left/right projections, against fixed geometry.
export async function checkProjectionMotion(page) {
  await page.evaluate(async () => {
    const {mat4}=await import('/node_modules/wgpu-matrix/dist/3.x/wgpu-matrix.module.js')
    const adapter=await navigator.gpu.requestAdapter(), device=await adapter.requestDevice()
    device.pushErrorScope('validation')
    const sources=await Promise.all(['/render/fluid.wgsl?raw','/render/densityRaymarch.wgsl?raw','/mls-mpm/updateGrid.wgsl?raw'].map(async p=>(await import(p)).default))
    const point=[2,1,-12,1]
    const transform=(m,v)=>[0,1,2,3].map(r=>m[r]*v[0]+m[4+r]*v[1]+m[8+r]*v[2]+m[12+r]*v[3])
    for (const code of sources) {
      const begin=code.indexOf('fn computeViewPosFromUVDepth('), end=code.indexOf('\n}',begin)+2
      const fn=code.slice(begin,end)
      const module=device.createShaderModule({code:`
        struct Uniforms { invProjectionMatrix:mat4x4f, invViewMatrix:mat4x4f, sample:vec4f }
        @group(0) @binding(0) var<uniform> uniforms:Uniforms;
        @group(0) @binding(1) var<storage,read_write> result:vec4f;
        ${fn}
        @compute @workgroup_size(1) fn main() {
          result=uniforms.invViewMatrix*vec4f(computeViewPosFromUVDepth(uniforms.sample.xy,uniforms.sample.z),1);
        }`})
      const pipeline=device.createComputePipeline({layout:'auto',compute:{module}})
      for (const angle of [0,0.35,-0.6]) for (const eye of [-1,1]) {
        const world=mat4.translation([angle*2+eye*0.032,1.6,angle])
        mat4.rotateY(world,angle,world); mat4.rotateZ(world,angle*0.2,world)
        const projection=mat4.perspective(1.4,0.9,0.1,1000)
        projection[8]=eye*0.15; projection[9]=0.05
        const viewPoint=transform(mat4.inverse(world),point), clip=transform(projection,viewPoint)
        const data=new Float32Array(36)
        data.set(mat4.inverse(projection)); data.set(world,16)
        data.set([(clip[0]/clip[3]+1)/2,(1-clip[1]/clip[3])/2,-viewPoint[2],0],32)
        const uniform=device.createBuffer({size:144,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})
        device.queue.writeBuffer(uniform,0,data)
        const out=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC})
        const read=device.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST})
        const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:1,resource:{buffer:out}}]})
        const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass()
        pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end()
        encoder.copyBufferToBuffer(out,0,read,0,16);device.queue.submit([encoder.finish()])
        await read.mapAsync(GPUMapMode.READ)
        const values=new Float32Array(read.getMappedRange())
        if (point.some((v,i)=>Math.abs(v-values[i])>0.001)) throw Error(`World position bends under head motion: ${Array.from(values)}`)
        read.unmap();uniform.destroy();out.destroy();read.destroy()
      }
    }
    const error=await device.popErrorScope();device.destroy();if(error)throw Error(error.message)
  })
}
