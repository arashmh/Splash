import { Camera } from './camera'
import { mlsmpmParticleStructSize, MLSMPMSimulator } from './mls-mpm/mls-mpm'
import { renderUniformsViews, renderUniformsValues } from './camera'
import { FluidRenderer } from './render/fluidRender'
import GUI from 'lil-gui';
import { startWebGPUXR, xrInput } from './xr'
import { XRStick } from './render/xrStick'

/// <reference types="@webgpu/types" />


async function init() {
	const canvas: HTMLCanvasElement = document.querySelector('canvas')!

	if (!navigator.gpu) {
		alert("WebGPU is not supported on your browser.");
		throw new Error()
	}

	// A device created from a regular WebGPU adapter cannot be submitted to an
	// immersive WebXR session on Quest. Ask the browser for the XR-compatible
	// adapter up front; this is required by the WebGPU/WebXR integration.
	const adapter = await navigator.gpu.requestAdapter({ xrCompatible: true })

	if (!adapter) {
		alert("Adapter is not available.");
		throw new Error()
	}

	const device = await adapter.requestDevice()
	device.addEventListener('uncapturederror', (event) => {
		const message = `GPU error: ${(event as GPUUncapturedErrorEvent).error.message}`
		console.error(message)
		document.getElementById('error-reason')!.textContent = message
	})
	// const device = await adapter.requestDevice({
	// 	requiredFeatures: ["float32-filterable"],
	// });

	if (!device) {
		alert("float-32-filterable is not supported")
		throw new Error()
	}

	const context = canvas.getContext('webgpu') as GPUCanvasContext

	if (!context) {
		throw new Error()	
	}

	let devicePixelRatio  = 0.7;
	canvas.width = devicePixelRatio * canvas.clientWidth
	canvas.height = devicePixelRatio * canvas.clientHeight

	console.log(canvas.width, canvas.height)

	const presentationFormat = navigator.gpu.getPreferredCanvasFormat()

	context.configure({
		device,
		format: presentationFormat,
	})

	return { canvas, device, presentationFormat, context }
}

function initGui(particleCountTexts: string[]) {
	const gui = new GUI();

	const params = {
		sigma: 1.3,
		running: true,
		r: 140, 
		g:220, 
		b:240,  
		speed: 0.97,
		colorDensity: 0.7, 
		numParticles: particleCountTexts[0],
		toggleSimulation: () => {
			params.running = !params.running;
		}
	};	

	const numParticlesFolder = gui.addFolder('Number of Particles');
	numParticlesFolder.add(params, 'numParticles', particleCountTexts)
  		.name('Number of Particles')
	const speedFolder = gui.addFolder('Speed');
	speedFolder.add(params, 'speed', 0.3, 1.0, 0.1).name('Simlation Speed')
	const colorFolder = gui.addFolder('Diffuse Color');
	colorFolder.add(params, 'r', 0, 255, 1).name('R')
	colorFolder.add(params, 'g', 0, 255, 1).name('G')
	colorFolder.add(params, 'b', 0, 255, 1).name('B')
	colorFolder.add(params, 'colorDensity', 0.0, 6.0, 0.1).name('Density')
	colorFolder.close();

	document.addEventListener('keydown', (event) => {
		if (event.code === 'KeyP') { 
		  params.toggleSimulation(); 
		}
	});

	return params
}

async function main() {
	const { canvas, device, presentationFormat, context } = await init();
	
	console.log("initialization done")

	context.configure({
		device,
		format: presentationFormat,
	})

	let cubemapTexture: GPUTexture;
	{
		// The order of the array layers is [+X, -X, +Y, -Y, +Z, -Z]
		const imgSrcs = [
			'cubemap/posx.png',
			'cubemap/negx.png',
			'cubemap/posy.png',
			'cubemap/negy.png',
			'cubemap/posz.png',
			'cubemap/negz.png',
		];
		const promises = imgSrcs.map(async (src) => {
			const response = await fetch(src);
			return createImageBitmap(await response.blob());
		});
		const imageBitmaps = await Promise.all(promises);
		const mipLevelCount = 1 + Math.floor(Math.log2(imageBitmaps[0].width));

		cubemapTexture = device.createTexture({
			dimension: '2d',
			// Create a 2d array texture.
			// Assume each image has the same size.
			size: [imageBitmaps[0].width, imageBitmaps[0].height, 6],
			mipLevelCount,
			format: 'rgba8unorm',
			usage:
			GPUTextureUsage.TEXTURE_BINDING |
			GPUTextureUsage.COPY_DST |
			GPUTextureUsage.RENDER_ATTACHMENT,
		});

		for (let i = 0; i < imageBitmaps.length; i++) {
			const imageBitmap = imageBitmaps[i];
			device.queue.copyExternalImageToTexture(
				{ source: imageBitmap },
				{ texture: cubemapTexture, origin: [0, 0, i] },
				[imageBitmap.width, imageBitmap.height]
			);
			for (let mip = 1; mip < mipLevelCount; mip++) {
				const width = Math.max(1, imageBitmap.width >> mip);
				const height = Math.max(1, imageBitmap.height >> mip);
				const reduced = await createImageBitmap(imageBitmap, {resizeWidth: width, resizeHeight: height, resizeQuality: 'high'});
				device.queue.copyExternalImageToTexture({source: reduced}, {texture: cubemapTexture, origin: [0,0,i], mipLevel: mip}, [width,height]);
				reduced.close();
			}
			imageBitmap.close();
		}
	}

	const cubemapTextureView = cubemapTexture.createView({
		dimension: 'cube',
	});
	console.log("cubemap initialization done")


	interface simulationParam {
		particleCount: number, 
		initBoxSize: number[], 
		initDistance: number, 
		mouseRadius: number,
		cameraTargetY: number, 
		guiText: string, 
	}

	let simulationParams: simulationParam[] = [
		{ particleCount: 40000, initBoxSize: [60, 50, 60], initDistance: 50, mouseRadius: 15, cameraTargetY: 10, guiText: 'Small (40,000 particles)' }, 
		{ particleCount: 70000, initBoxSize: [70, 50, 70], initDistance: 60, mouseRadius: 15, cameraTargetY: 12, guiText: 'Medium (70,000 particles)'}, 
		{ particleCount: 100000, initBoxSize: [80, 70, 80], initDistance: 70, mouseRadius: 15, cameraTargetY: 12, guiText: 'Large (100,000 particles)'}, 
		{ particleCount: 180000, initBoxSize: [90, 70, 90], initDistance: 80, mouseRadius: 18, cameraTargetY: 15, guiText: 'Very Large (180,000 particles)'}, 
	]
	const particleCountTexts = simulationParams.map(param => param.guiText)
	const guiParams = initGui(particleCountTexts)
	const maxParticleCount = Math.max(...simulationParams.map(param => param.particleCount));
	const maxGridCount = Math.max(...simulationParams.map(param => param.initBoxSize[0] * param.initBoxSize[1] * param.initBoxSize[2]));

	// シミュレーションとレンダリングで使いまわすバッファ
	const maxParticleStructSize = mlsmpmParticleStructSize
	const particleBuffer = device.createBuffer({
		label: 'particles buffer', 
		size: maxParticleStructSize * maxParticleCount, 
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	})
	const posvelBuffer = device.createBuffer({
		label: 'posvel buffer', 
		size: 32 * maxParticleCount,  
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	})
	const renderUniformBuffer = device.createBuffer({
		label: 'filter uniform buffer', 
		size: renderUniformsValues.byteLength, 
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	})
	const initBoxSizeBuffer = device.createBuffer({
		label: 'init box size buffer', 
		size: 12,  // vec3f
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	})

	// texture for depthmap
	const depthMapTexture = device.createTexture({
		label: 'depth map texture', 
		size: [canvas.width, canvas.height, 1],
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		format: 'r32float',
	});
	const depthMapTextureView = depthMapTexture.createView()

	// texture for density grid
	// const densityGridSizeX = Math.ceil(Math.max(...simulationParams.map(param => param.initBoxSize[0])) / 64) * 64; // コピーのために切り上げ
	const densityGridSizeX = Math.max(...simulationParams.map(param => param.initBoxSize[0])); // コピーのために切り上げ
	const densityGridSizeY = Math.max(...simulationParams.map(param => param.initBoxSize[1]));
	const densityGridSizeZ = Math.ceil(Math.max(...simulationParams.map(param => param.initBoxSize[2])) / 128) * 128;
	const densityGridSize = [densityGridSizeX, densityGridSizeY, densityGridSizeZ]
	const densityGridBuffer = device.createBuffer({
		label: 'density grid buffer', 
		size: 4 * densityGridSizeX * densityGridSizeY * densityGridSizeZ, 
		usage: GPUBufferUsage.STORAGE, // コピー元
	})
	const castedDensityGridBuffer = device.createBuffer({
		label: 'casted density grid buffer', 
		size: 2 * densityGridSizeX * densityGridSizeY * densityGridSizeZ, 
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, // コピー元
	})
	const densityGridSizeBuffer = device.createBuffer({
		label: 'density grid size buffer', 
		size: 12, 
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 
	})
	const densityGridSizeDataArray = new Float32Array(densityGridSize)
	device.queue.writeBuffer(densityGridSizeBuffer, 0, densityGridSizeDataArray)
	const densityGridTexture = device.createTexture({ 
		label: 'density grid texture', 
		size: [densityGridSizeZ, densityGridSizeY, densityGridSizeX], // これでいい？
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST, // コピー先
		format: 'r16float',
		dimension: '3d'
	})
	const densityGridTextureView = densityGridTexture.createView()
	console.log("buffer allocating done")

	const canvasElement = document.getElementById("fluidCanvas") as HTMLCanvasElement;
	// シミュレーション，カメラの初期化
	const mlsmpmFov = 60 * Math.PI / 180
	const mlsmpmRadius = 0.6
	const mlsmpmDiameter = 2 * mlsmpmRadius
	const mlsmpmZoomRate = 0.7
	const fixedPointMultiplier = 1e7
	const mlsmpmSimulator = new MLSMPMSimulator(
		particleBuffer, posvelBuffer, renderUniformBuffer, densityGridBuffer, castedDensityGridBuffer, 
		initBoxSizeBuffer, densityGridSizeBuffer, 
		device, depthMapTextureView, canvas, 
		maxGridCount, maxParticleCount, fixedPointMultiplier, mlsmpmDiameter
	)
	const mlsmpmRenderer = new FluidRenderer(
		renderUniformBuffer, posvelBuffer, densityGridSizeBuffer, initBoxSizeBuffer, 
		device, 
		depthMapTextureView, cubemapTextureView, densityGridTextureView, 
		canvas, 
		presentationFormat, 
		mlsmpmRadius, mlsmpmFov, fixedPointMultiplier
	)

	console.log("simulator initialization done")

	const xrButton = document.getElementById('enter-vr') as HTMLButtonElement
	const stick = new XRStick(device, presentationFormat)
	const stereoResources = new Map<string, {renderer: FluidRenderer; uniforms: GPUBuffer; depth: GPUTexture; width: number; height: number}>()
	if (navigator.xr) {
		xrButton.hidden = false
		xrButton.onclick = async () => {
			try {
				xrButton.disabled = true
				const session = await startWebGPUXR(device, presentationFormat, (view, target, viewport) => {
					const key = view.eye
					let eye = stereoResources.get(key)
					const scale = Math.min(1, 800 / Math.max(viewport.width, viewport.height))
					const width = Math.max(2, Math.round(viewport.width * scale / 2) * 2)
					const height = Math.max(2, Math.round(viewport.height * scale / 2) * 2)
					if (!eye || eye.width !== width || eye.height !== height) {
						eye?.renderer.dispose(); eye?.uniforms.destroy(); eye?.depth.destroy()
						// Keep the native eye aspect ratio throughout every offscreen pass.
						const eyeCanvas = document.createElement('canvas')
						eyeCanvas.width = width; eyeCanvas.height = height
						const uniforms = device.createBuffer({size: renderUniformsValues.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST})
						const depth = device.createTexture({size: [width,height], format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING})
						const renderer = new FluidRenderer(uniforms, posvelBuffer, densityGridSizeBuffer, initBoxSizeBuffer,
							device, depth.createView(), cubemapTextureView, densityGridTextureView, eyeCanvas,
							presentationFormat, mlsmpmRadius, mlsmpmFov, fixedPointMultiplier)
						eye = {renderer, uniforms, depth, width, height}
						stereoResources.set(key, eye)
					}
					const xrEncoder = device.createCommandEncoder()
					renderUniformsViews.texelSize.set([1 / eye.width, 1 / eye.height])
					device.queue.writeBuffer(eye.uniforms, 0, renderUniformsValues)
					eye.renderer.execute(null, xrEncoder, mlsmpmSimulator.numParticles, sphereRenderFl,
						[guiParams.r / 255, guiParams.g / 255, guiParams.b / 255], guiParams.colorDensity, target, viewport)
					stick.draw(xrEncoder, target, viewport)
					device.queue.submit([xrEncoder.finish()])
				}, () => frame(true), () => realBoxSize)
				session.addEventListener('end', () => {
					xrButton.disabled = false
					camera.reset(simulationParam.initDistance, [initBoxSize[0]/2, simulationParam.cameraTargetY, initBoxSize[2]/2], mlsmpmFov, mlsmpmZoomRate)
				})
			} catch (error) {
				console.warn(error)
				xrButton.disabled = false
                const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
                const message = `VR startup failed: ${reason}`
                document.getElementById('error-reason')!.textContent = message
                alert(message)
			}
		}
	}

	const camera = new Camera(canvasElement)

	// デバイスロストの監視
	let errorLog = document.getElementById('error-reason') as HTMLSpanElement
	errorLog.textContent = ""
	device.lost.then(info => {
		const reason = info.reason ? `reason: ${info.reason}` : 'unknown reason';
		errorLog.textContent = reason;
	});

	let paramsIdx = -1
	let realBoxSize = [0, 0, 0]
	let initBoxSize = [0, 0, 0]
	let simulationParam = simulationParams[0]

	let sphereRenderFl = false
	let rotateFl = false
	let boxWidthRatio = 1.

	console.log("simulation start")
	let closingSpeed = 0.
	let prevClosingSpeed = 0.

	
	function frame(fromXR = false) {
		if (!fromXR) {
			requestAnimationFrame(() => frame())
			if (xrInput.active) return
		}
		const selectedValue = particleCountTexts.indexOf(guiParams.numParticles);
		if (guiParams.running && Number(selectedValue) != paramsIdx) {
			paramsIdx = Number(selectedValue)
			simulationParam = simulationParams[paramsIdx]
			initBoxSize = simulationParam.initBoxSize
			mlsmpmSimulator.reset(initBoxSize, simulationParam.particleCount)
			camera.reset(simulationParam.initDistance, [initBoxSize[0] / 2, simulationParam.cameraTargetY, initBoxSize[2] / 2], 
				mlsmpmFov, mlsmpmZoomRate)
			realBoxSize = [...initBoxSize]
			let slider = document.getElementById("slider") as HTMLInputElement
			slider.value = "100"
		}

		const particle = document.getElementById("particle") as HTMLInputElement
		sphereRenderFl = particle.checked
		if (guiParams.running) {
			const slider = document.getElementById("slider") as HTMLInputElement
			let curBoxWidthRatio = parseInt(slider.value) / 200 + 0.5
			const maxClosingSpeed = 0.007 * guiParams.speed
			closingSpeed = Math.min(maxClosingSpeed, prevClosingSpeed + maxClosingSpeed / 40.)
			let dVal = Math.min(boxWidthRatio - curBoxWidthRatio, closingSpeed)
			boxWidthRatio -= dVal
			if (dVal <= 0.) {
				closingSpeed = 0.
				prevClosingSpeed = 0.
			} else {
				prevClosingSpeed = closingSpeed
			}	
		}

		realBoxSize[2] = initBoxSize[2] * boxWidthRatio
		mlsmpmSimulator.changeBoxSize(realBoxSize)

		// matrices are written by camera.ts
		renderUniformsViews.texelSize.set([1.0 / canvas.width, 1.0 / canvas.height]);
		renderUniformsViews.sphereSize.set([mlsmpmDiameter])
		device.queue.writeBuffer(renderUniformBuffer, 0, renderUniformsValues) 

		const commandEncoder = device.createCommandEncoder()

		let maxDt = 0.4;
		mlsmpmSimulator.mouseInfoViews.xrEnabled[0] = xrInput.active ? (xrInput.tracked ? 1 : -1) : 0
		mlsmpmSimulator.mouseInfoViews.xrPosition.set(xrInput.position)
		mlsmpmSimulator.mouseInfoViews.xrVelocity.set(xrInput.velocity)
		mlsmpmSimulator.mouseInfoViews.xrOrigin.set(xrInput.origin)
		mlsmpmSimulator.mouseInfoViews.xrOriginVelocity.set(xrInput.originVelocity)
		mlsmpmSimulator.execute(commandEncoder,
			[camera.currentHoverX / canvas.clientWidth, camera.currentHoverY / canvas.clientHeight],
			xrInput.active ? [0,0] : camera.calcMouseVelocity(), xrInput.active ? 5 : simulationParam.mouseRadius, sphereRenderFl, maxDt * guiParams.speed, guiParams.running,
			densityGridSize
		)	
		let normalizedDiffuseColor = [guiParams.r / 255, guiParams.g / 255, guiParams.b / 255];
		if (!fromXR) mlsmpmRenderer.execute(context, commandEncoder, mlsmpmSimulator.numParticles, sphereRenderFl, normalizedDiffuseColor,
			guiParams.colorDensity)

		device.queue.submit([commandEncoder.finish()])

		if (sphereRenderFl) {
			const copyCommandEncoder = device.createCommandEncoder()
			// グリッドをテクスチャへコピー
			copyCommandEncoder.copyBufferToTexture(
				{
					buffer: castedDensityGridBuffer,
					bytesPerRow: densityGridSize[2] * 2,
					rowsPerImage: densityGridSize[1]
				},
				{
					texture: densityGridTexture
				},
				{
					width: densityGridSize[2],
					height: densityGridSize[1],
					depthOrArrayLayers: densityGridSize[0]
				}
			);
			device.queue.submit([copyCommandEncoder.finish()])
		}


		camera.setNewPrevMouseCoord();
		if (rotateFl) {
			camera.stepAngle();
		}

	} 
	requestAnimationFrame(() => frame())
}

main()

