// Splash is a custom WebGPU app, without an IWSDK World. IWSDK's browser
import { installWebGPUXREmulation } from './webgpu-xr-emulation'
// client waits for this runtime adapter before enabling IWER commands.
// Leave all methods to IWER; do not claim scene/ECS capabilities we don't own.
const host = window as typeof window & {
  FRAMEWORK_MCP_RUNTIME?: { handles(method: string): boolean; dispatch(method: string): Promise<never> }
}
host.FRAMEWORK_MCP_RUNTIME ??= {
  handles: () => false,
  dispatch: async (method) => { throw new Error(`Splash does not implement framework method: ${method}`) },
}
window.dispatchEvent(new Event('iwsdk:mcp-runtime-ready'))
installWebGPUXREmulation()
