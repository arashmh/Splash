import { chromium } from 'playwright'
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
  const status=await page.locator('#error-reason').textContent()
  console.log(JSON.stringify({status,errors},null,2))
  if (status || errors.length) process.exitCode=1
} finally { await browser.close() }
