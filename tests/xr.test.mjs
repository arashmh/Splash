import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('XR frame loop, Quest axes, stick rotation, tracking loss and teardown', async () => {
  const bundle = await build({stdin:{contents:"export * from './xr'; export {renderUniformsViews} from './camera'",resolveDir:process.cwd(),loader:'ts'}, bundle:true, write:false, format:'esm', platform:'node'})
  const {startWebGPUXR, xrInput, renderUniformsViews} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
  const identity = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])
  let callback, onEnd, steps=0, renders=0, ended=false
  const left={handedness:'left',gamepad:{axes:[0,0,0,0]}}
  const right={handedness:'right',targetRaySpace:{},gamepad:{axes:[0,0,0,0]}}
  const session={inputSources:[left,right], updateRenderState(){}, async requestReferenceSpace(){return {}},
    requestAnimationFrame(cb){callback=cb},addEventListener(_,cb){onEnd=cb},async end(){ended=true;onEnd?.()}}
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{},xr:{requestSession:async()=>session}}})
  globalThis.XRGPUBinding=class {createProjectionLayer(){return {}} getViewSubImage(){return {colorTexture:{createView(){return {}}},getViewDescriptor(){return {}},viewport:{x:0,y:0,width:100,height:100}}}}
  const ray=new Float32Array(identity); ray[13]=1.4
  let tracked=true
  const frame={getViewerPose(){return {views:[{projectionMatrix:identity,transform:{inverse:{matrix:identity}}}]}},getPose(){return tracked?{transform:{matrix:ray}}:null}}
  await startWebGPUXR({},'rgba8unorm',()=>renders++,()=>steps++,()=>[60,50,60])
  callback(1000,frame)
  const camera = renderUniformsViews.invViewMatrix
  assert.equal(Math.hypot(camera[0],camera[1],camera[2]),1,'XR camera must not scale particle radii')
  assert.equal(camera[12],30,'camera translation remains in simulation units')
  assert.equal(camera[14],75,'spawn remains 1.2 metres outside the larger tank')
  const initial=xrInput.position[2]
  left.gamepad.axes[3]=-1
  callback(1020,frame)
  assert.ok(xrInput.position[2]<initial,'Quest thumbstick moves player forward')
  assert.equal(xrInput.velocity[2],0,'locomotion must not inject artificial water velocity')
  left.gamepad.axes[3]=0; ray[8]=0.2
  callback(1040,frame)
  assert.notEqual(xrInput.velocity[0],0,'controller rotation moves the stick tip')
  tracked=false; callback(1060,frame)
  assert.equal(xrInput.tracked,false); assert.deepEqual(xrInput.velocity,[0,0,0,0])
  assert.equal(steps,4); assert.equal(renders,4)
  await session.end(); assert.equal(xrInput.active,false)
  globalThis.XRGPUBinding=class {constructor(){throw new Error('binding failure')}}
  ended=false
  await assert.rejects(()=>startWebGPUXR({},'rgba8unorm',()=>{},()=>{},()=>[60,50,60]),/binding failure/)
  assert.equal(ended,true,'failed setup ends the acquired session')
})
