import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';

export default defineConfig({
  // Splash owns its WebGPU scene; enable the managed tools without a native
  // IWSDK scene manifest. Honour the CLI's requested browser mode.
  plugins: [glsl(), iwsdkDev({
    ai: { mode: process.env.IWSDK_DEV_AI_MODE === 'agent' ? 'agent' : 'collaborate' },
  })],
});
