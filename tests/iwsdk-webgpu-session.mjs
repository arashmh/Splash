import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const cli='node_modules/@iwsdk/cli/dist/cli.js'
function call(args,input) {
  const processResult=spawnSync(process.execPath,[cli,...args,...(input ? ['--input-json',JSON.stringify(input)] : [])],{encoding:'utf8',timeout:30000})
  assert.ok(processResult.stdout?.trim(),`${args.join(' ')}: ${processResult.stderr} ${processResult.error ?? ''}`)
  const result=JSON.parse(processResult.stdout)
  assert.equal(result.ok,true,JSON.stringify(result.error))
  return result.data.screenshotPath ? {...result.data.result,screenshotPath:result.data.screenshotPath} : result.data.result
}
const started=Date.now()
call(['browser','reload'])
await new Promise(resolve=>setTimeout(resolve,2000))
call(['browser','interact'],{steps:[{action:'click',locator:{role:'button',name:'Enter WebGPU VR'}}]})
await new Promise(resolve=>setTimeout(resolve,2000))
const status=call(['xr','status'])
assert.equal(status.sessionActive,true,'WebGPU immersive session must be active')
call(['xr','set-device-state'],{state:{stereoEnabled:true}})
call(['xr','set-device-state'],{state:{headset:{position:{x:0.2,y:1.6,z:0.1},orientation:{x:0,y:0.13,z:0,w:0.9915}}}})
await new Promise(resolve=>setTimeout(resolve,1000))
const state=call(['xr','get-device-state'])
assert.equal(state.stereoEnabled,true)
const screenshot=call(['browser','screenshot'])
const logs=call(['browser','logs'],{count:40})
const errors=logs.filter(entry=>entry.timestamp>=started && (entry.level==='error'||/GPU error|failed/i.test(entry.message)))
assert.deepEqual(errors,[])
console.log(JSON.stringify({sessionActive:status.sessionActive,stereoEnabled:state.stereoEnabled,headset:state.headset,screenshot},null,2))
call(['xr','exit'])
