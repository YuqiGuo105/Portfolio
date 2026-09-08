import assert from 'node:assert/strict'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright')
const base = process.env.CHAT_TEST_URL || 'http://127.0.0.1:3081'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    page.setDefaultTimeout(15000)
    const grants = [], uploads = [], deletions = [], turns = []
    let holdUpload = false, finishUpload, failUpload = false
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.pathname.endsWith('/attachments/upload-url')) {
        const data = request.postDataJSON(), id = `test-attachment-${grants.length + 1}`
        grants.push({ ...data, id })
        return route.fulfill({ status: 201, json: { attachmentId: id, mimeType: data.mimeType, uploadUrl: `${base}/__fixture-upload/${id}` } })
      }
      if (url.pathname.startsWith('/__fixture-upload/')) {
        uploads.push(request.method())
        if (holdUpload) await new Promise(resolve => { finishUpload = resolve })
        return route.fulfill({ status: failUpload ? 500 : 200, body: '' })
      }
      if (url.pathname.includes('/attachments/') && request.method() === 'DELETE') {
        deletions.push(url.pathname.split('/').at(-1))
        return route.fulfill({ status: 204 })
      }
      if (url.pathname.endsWith('/answer/stream')) {
        turns.push(request.postDataJSON())
        return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"stage":"answer_final","payload":{"answer":"Attachment received."}}\n\ndata: {"stage":"done"}\n\n' })
      }
      if (url.hostname.endsWith('supabase.co') && request.method() !== 'GET') return route.abort()
      return route.continue()
    })
    await page.goto(`${base}/?openChat=1`, { waitUntil: 'domcontentloaded' })
    const panel = page.locator('#__chat_widget_root .bot-container')
    await panel.waitFor()
    const transfer = files => page.evaluateHandle(files => {
      const data = new DataTransfer()
      for (const file of files) data.items.add(new File([new Uint8Array(file.size ?? 32)], file.name, { type: file.type ?? 'application/pdf', lastModified: 1 }))
      return data
    }, files)
    const drop = async files => {
      const data = await transfer(files)
      await panel.dispatchEvent('dragenter', { dataTransfer: data })
      await panel.dispatchEvent('drop', { dataTransfer: data })
      await data.dispose()
      assert.equal(await panel.locator('.cw-file-drop').count(), 0)
    }
    const ready = async count => {
      await page.waitForFunction(count => document.querySelectorAll('#__chat_widget_root .cw-tray .cw-chip').length === count, count)
    }
    const removeAll = async () => {
      while (await page.getByRole('button', { name: 'Remove file', exact: true }).count()) {
        const deleted = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes('/attachments/'))
        await page.getByRole('button', { name: 'Remove file', exact: true }).first().click()
        await deleted
      }
    }

    const text = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData('text/plain', 'hello'); return data })
    await panel.dispatchEvent('dragenter', { dataTransfer: text })
    assert.equal(await panel.locator('.cw-file-drop').count(), 0)
    await text.dispose()
    const pdf = await transfer([{ name: 'sample.pdf' }])
    await panel.dispatchEvent('dragenter', { dataTransfer: pdf })
    await panel.locator('.bot-header').dispatchEvent('dragenter', { dataTransfer: pdf })
    await panel.locator('.bot-header').dispatchEvent('dragleave', { dataTransfer: pdf })
    await panel.locator('.cw-file-drop').waitFor()
    await page.screenshot({ path: `/private/tmp/chat-drop-overlay-${width}.png` })
    await panel.dispatchEvent('dragleave', { dataTransfer: pdf })
    assert.equal(await panel.locator('.cw-file-drop').count(), 0)
    assert.equal(await page.evaluate(data => {
      const event = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
      document.body.dispatchEvent(event)
      return event.defaultPrevented
    }, pdf), true)
    await pdf.dispose()
    assert.equal(grants.length, 0)

    for (const file of [{ name: 'program.exe', type: 'application/x-msdownload' }, { name: 'large.pdf', size: 5 * 1024 * 1024 + 1 }, { name: 'empty.pdf', size: 0 }]) {
      await drop([file]); assert.equal(grants.length, 0)
    }
    const folder = await transfer([{ name: 'folder' }])
    await panel.evaluate((element, data) => {
      const original = DataTransferItem.prototype.webkitGetAsEntry
      try {
        DataTransferItem.prototype.webkitGetAsEntry = () => ({ isDirectory: true })
        element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }))
      } finally { DataTransferItem.prototype.webkitGetAsEntry = original }
    }, folder)
    await folder.dispose()
    assert.equal(grants.length, 0)
    assert.match(await panel.innerText(), /individual files, not folders/)

    await drop([{ name: 'sample.pdf' }, { name: 'sample.pdf' }]); await ready(1)
    assert.equal(grants.length, 1); assert.equal(uploads[0], 'PUT')
    await drop([{ name: 'sample.pdf' }]); assert.equal(grants.length, 1)
    await removeAll(); assert.ok(deletions.includes(grants[0].id))
    await drop([{ name: 'a.pdf' }, { name: 'b.pdf' }, { name: 'c.pdf' }]); await ready(2)
    assert.equal(grants.length, 3)
    await drop([{ name: 'c.pdf' }]); assert.equal(grants.length, 3)
    await removeAll()

    holdUpload = true
    const permission = page.waitForResponse(r => r.url().endsWith('/attachments/upload-url'))
    await drop([{ name: 'pending.pdf' }]); await permission
    await drop([{ name: 'concurrent.pdf' }])
    assert.equal(grants.length, 4)
    while (!finishUpload) await new Promise(resolve => setTimeout(resolve, 10))
    holdUpload = false; finishUpload(); await ready(1); await removeAll()

    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Upload file', exact: true }).click()
    await (await chooser).setFiles({ name: 'button.txt', mimeType: 'text/plain', buffer: Buffer.from('button upload') })
    await ready(1); assert.equal(grants.length, 5); await removeAll()

    failUpload = true
    const failedCleanup = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes('/attachments/'))
    await drop([{ name: 'failure.pdf' }]); await failedCleanup; await ready(1)
    assert.match(await panel.innerText(), /failed/)
    await removeAll(); failUpload = false

    await drop([{ name: 'send.pdf' }]); await ready(1)
    const cleanup = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes('/attachments/'))
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('Read the attachment.')
    await page.getByRole('button', { name: 'Send message', exact: true }).click()
    await cleanup
    await page.getByText('Attachment received.', { exact: true }).waitFor()
    assert.equal(turns[0].attachments[0].id, grants.at(-1).id)
    assert.equal(turns[0].attachments[0].file, undefined)
    assert.ok(deletions.includes(grants.at(-1).id))
    await page.screenshot({ path: `/private/tmp/chat-drop-completed-${width}.png` })
    console.log(JSON.stringify({ width, passed: true, uploads: uploads.length, cleanupRequests: deletions.length, liveModelCalled: false }))
    await page.close()
  }
} finally { await browser.close() }
