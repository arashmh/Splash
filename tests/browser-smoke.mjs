import { chromium } from 'playwright'
import { checkStereoAtlas } from './stereo-atlas.mjs'
const browser = await chromium.launch({headless:true,
  ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}),
  args:['--enable-unsafe-webgpu']})
try {
  const page = await browser.newPage({ignoreHTTPSErrors:true})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error') errors.push(`${m.text()} ${m.location().url}`)})
  page.on('dialog',async d=>{errors.push(d.message());await d.dismiss()})
  await page.goto(process.env.SPLASH_URL ?? 'https://localhost:5173/')
  await page.waitForTimeout(8000)
  await checkStereoAtlas(page)
  // Exercise the actual compute shader: the middle of the shaft must stir,
  // even when it is far from both endpoints; cells off the shaft stay still.
  await page.evaluate(async () => {
    const {default: code} = await import('/mls-mpm/updateGrid.wgsl?raw')
    const adapter = await navigator.gpu.requestAdapter()
    const device = await adapter.requestDevice()
    device.pushErrorScope('validation')
    const buffer = (data, usage) => {
      const b = device.createBuffer({size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST})
      device.queue.writeBuffer(b,0,data); return b
    }
    const index=(x,y,z)=>(x*16*16+y*16+z)*4
    const data=new Int32Array(16*16*16*4)
    for(const [x,y,z] of [[4,8,8],[8,8,8],[12,8,8],[8,8,12]]) data[index(x,y,z)+3]=10000000
    const cells=buffer(data,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC)
    const size=buffer(new Float32Array([16,16,16,0]),GPUBufferUsage.UNIFORM)
    const camera=buffer(new Float32Array(68),GPUBufferUsage.UNIFORM)
    const interaction=new Float32Array(24)
    interaction[6]=1.2; interaction[7]=1
    interaction.set([12,8,8,0],8); interaction.set([0,2,0,0],12)
    interaction.set([4,8,8,0],16); interaction.set([0,2,0,0],20)
    const info=buffer(interaction,GPUBufferUsage.UNIFORM)
    const dt=buffer(new Float32Array([0]),GPUBufferUsage.UNIFORM)
    const texture=device.createTexture({size:[1,1],format:'r32float',usage:GPUTextureUsage.TEXTURE_BINDING})
    const pipeline=device.createComputePipeline({layout:'auto',compute:{module:device.createShaderModule({code}),entryPoint:'updateGrid',constants:{fixedPointMultiplier:1e7,fixedPointMultiplierInverse:1e-7}}})
    const resources=[{buffer:cells},{buffer:size},{buffer:size},{buffer:camera},texture.createView(),{buffer:info},{buffer:dt}]
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource}))})
    const read=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})
    const encoder=device.createCommandEncoder(), pass=encoder.beginComputePass()
    pass.setPipeline(pipeline); pass.setBindGroup(0,group); pass.dispatchWorkgroups(64); pass.end()
    encoder.copyBufferToBuffer(cells,0,read,0,data.byteLength); device.queue.submit([encoder.finish()])
    await read.mapAsync(GPUMapMode.READ)
    const result=new Int32Array(read.getMappedRange())
    for(const x of [4,8,12]) if(result[index(x,8,8)+1]<=0) throw new Error('Stick contact failed at x='+x)
    if(result[index(8,8,12)+1]!==0) throw new Error('Stick force leaked outside shaft')
    read.unmap()
    const error=await device.popErrorScope(); device.destroy()
    if(error) throw new Error(error.message)
  })
  const status=await page.locator('#error-reason').textContent()
  if (process.env.SPLASH_SCREENSHOT) await page.screenshot({path:process.env.SPLASH_SCREENSHOT})
  console.log(JSON.stringify({status,errors},null,2))
  if (status || errors.length) process.exitCode=1
} finally { await browser.close() }
