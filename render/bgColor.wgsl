@group(0) @binding(0) var envmapTexture: texture_cube<f32>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var textureSampler: sampler;
struct Uniforms {
    texelSize: vec2f, sphereSize: f32,
    invProjectionMatrix: mat4x4f, projectionMatrix: mat4x4f,
    viewMatrix: mat4x4f, invViewMatrix: mat4x4f,
}
struct FragmentInput { @location(0) uv: vec2f, @location(1) iuv: vec2f }
@fragment fn fs(input: FragmentInput) -> @location(0) vec4f {
    // Standard skybox: unproject the eye ray, rotate it, ignore camera position.
    // Full inverse projection supports the asymmetric projection of each XR eye.
    let ray = uniforms.invProjectionMatrix * vec4f(input.uv.x*2-1,1-input.uv.y*2,0.5,1);
    let direction = normalize((uniforms.invViewMatrix * vec4f(ray.xyz/ray.w,0)).xyz);
    return vec4f(textureSample(envmapTexture,textureSampler,direction).rgb,1);
}
