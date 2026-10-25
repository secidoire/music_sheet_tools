import { test, expect } from '@playwright/test'
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib'

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript((single) => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => single ? 2 : 8 })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 })
  }, info.project.name === 'single-worker')
})

test('local image, filename text, OpenCV preview and PDF export stay local', async ({ page }) => {
  const external: string[] = []
  page.on('request', (r) => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:43827/')) external.push(r.url()) })
  await page.goto('./')
  const image = await (await page.request.get('sample.jpg')).body()
  const name = '<img src=x onerror=alert(1)>.jpg'
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'image/jpeg', buffer: image })
  await expect(page).toHaveTitle(new RegExp('onerror=alert'))
  await expect(page.locator('.angle input[type=number]')).toBeEnabled({ timeout: 45_000 })
  const exportButton = page.getByRole('button', { name: '書き出し', exact: true })
  await expect(exportButton).toBeEnabled({ timeout: 45_000 })
  await exportButton.click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: /ダウンロード/ }).click()
  expect((await download).suggestedFilename()).toContain('_A4.pdf')
  expect(await page.locator('img[onerror]').count()).toBe(0)
  expect(external).toEqual([])
})

test('PDF page count and UserUnit amplification fail visibly', async ({ page }) => {
  await page.goto('./')
  const many = await PDFDocument.create()
  for (let n = 0; n < 201; n++) many.addPage([300, 300])
  await page.locator('input[type=file]').setInputFiles({ name: 'many.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await many.save()) })
  await expect(page.getByRole('alert')).toContainText('200')
  const amplified = await PDFDocument.create()
  amplified.addPage([300, 300]).node.set(PDFName.of('UserUnit'), PDFNumber.of(100))
  await page.locator('input[type=file]').setInputFiles({ name: 'amplified.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await amplified.save()) })
  await expect(page.getByText(/Page exceeds the 80 megapixel/).first()).toBeVisible()
})

test('malformed PDF fails on the empty screen', async ({ page }) => {
  await page.goto('./')
  await page.locator('input[type=file]').setInputFiles({ name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\ninvalid') })
  await expect(page.getByRole('alert')).toBeVisible()
})

test('oversized embedded PDF image is rejected instead of silently omitted', async ({ page }) => {
  await page.goto('./')
  const doc = await PDFDocument.create()
  const sheet = doc.addPage([300, 300])
  const image = await doc.embedJpg(await (await page.request.get('sample.jpg')).body())
  sheet.drawImage(image, { x: 0, y: 0, width: 300, height: 300 })
  await doc.flush()
  const stream = doc.context.lookup(image.ref, PDFRawStream)
  stream.dict.set(PDFName.of('Width'), PDFNumber.of(10000))
  stream.dict.set(PDFName.of('Height'), PDFNumber.of(8001))
  await page.locator('input[type=file]').setInputFiles({ name: 'huge-image.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) })
  await expect(page.getByRole('alert')).toContainText(/Image exceeded maximum allowed size/, { timeout: 15_000 })
  await page.getByRole('button', { name: '書き出し', exact: true }).click()
  await page.getByRole('menuitem', { name: /ダウンロード/ }).click()
  await expect(page.getByText('Some pages could not be processed. Open a valid document before exporting.')).toBeVisible()
})

test('ordinary scanned PDF renders with the bounded canvas factory', async ({ page }) => {
  await page.goto('./')
  const doc = await PDFDocument.create()
  const sample = await doc.embedJpg(await (await page.request.get('sample.jpg')).body())
  doc.addPage([595, 842]).drawImage(sample, { x: 0, y: 0, width: 595, height: 842 })
  await page.locator('input[type=file]').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) })
  await expect(page.locator('.angle input[type=number]')).toBeEnabled({ timeout: 45_000 })
  await expect(page.locator('.sheets img').first()).toBeVisible({ timeout: 15_000 })
  expect(await page.locator('.sheets img').first().evaluate(async (element) => {
    const image = element as HTMLImageElement
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0, 128, 128)
    return ctx.getImageData(0, 0, 128, 128).data.some((v, i) => i % 4 !== 3 && v < 180)
  })).toBe(true)
  await expect(page.getByRole('alert')).toHaveCount(0)
})


