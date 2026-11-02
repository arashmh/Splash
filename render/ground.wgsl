struct Uniforms {
    texelSize: vec2f, sphereSize: f32,
    invProjectionMatrix: mat4x4f, projectionMatrix: mat4x4f,
    viewMatrix: mat4x4f, invViewMatrix: mat4x4f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
struct Vertex { @builtin(position) position: vec4f, @location(0) world: vec3f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
    let corners = array(vec2f(-300,-300),vec2f(300,-300),vec2f(300,300),
                        vec2f(-300,-300),vec2f(300,300),vec2f(-300,300));
    let world = vec3f(corners[i].x,0,corners[i].y);
    return Vertex(uniforms.projectionMatrix * uniforms.viewMatrix * vec4f(world,1),world);
}
@fragment fn fs(input: Vertex) -> @location(0) vec4f {
    let grid = input.world.xz / 12.5;
    let footprint = max(fwidth(grid),vec2f(1e-5));
    let distance = abs(fract(grid + 0.5)-0.5);
    let lines = 1.0-smoothstep(vec2f(0.015)-footprint,vec2f(0.015)+footprint,distance);
    let fade = 1.0-smoothstep(0.15,0.8,max(footprint.x,footprint.y));
    return vec4f(mix(vec3f(0.32,0.36,0.39),vec3f(0.53,0.58,0.61),max(lines.x,lines.y)*fade),1);
}
