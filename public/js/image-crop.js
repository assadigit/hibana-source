// image-crop.js — S161 (spec #1): the folder-banner crop tool.
// A fixed wide aspect (2.5:1) modal: drag-to-pan + wheel-zoom over a checkered
// stage, Apply exports the visible crop region as WebP (PNG fallback where the
// browser lacks webp canvas export — the image-resize Safari lesson, folded).
// No dependencies beyond the browser's Canvas API.
//
// Exposed via window.hibanaImageCrop — used by sparks-page.js (banner flow) and
// spark-page.js (nothing yet — the idea gallery uploads uncropped, spec #7).
window.hibanaImageCrop = (() => {
  /**
   * Open the crop modal for one image file.
   * @param {File} file — the picked image
   * @param {object} opts — { aspect = 2.5, maxW = 1250, quality = 0.85, mimeType = 'image/webp' }
   * @returns {Promise<{dataBase64: string, mimeType: string} | null>} — null when cancelled
   */
  function openCrop(file, opts = {}) {
    const { aspect = 2.5, maxW = 1250, quality = 0.85, mimeType = 'image/webp' } = opts
    const t = (k, f) => { const s = window.hibanaI18n?.t(k); return s && s !== k ? s : f }
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => { URL.revokeObjectURL(img.src); start() }
      img.onerror = () => { URL.revokeObjectURL(img.src); resolve(null) }
      img.src = URL.createObjectURL(file)

      function start() {
        let scale = 1, tx = 0, ty = 0, dragging = null, raf = 0
        const dlg = document.createElement('dialog')
        dlg.className = 'dialog crop-dialog'
        dlg.id = 'hibana-crop-dialog'
        dlg.innerHTML =
          '<form class="modal" method="dialog">' +
            '<h3 class="crop-title">' + t('sparks.cropTitle', 'Crop banner') + '</h3>' +
            '<div class="crop-stage" data-crop-stage><canvas data-crop-canvas></canvas></div>' +
            '<p class="muted small crop-hint">' + t('sparks.cropHint', 'Drag to reposition · scroll to zoom') + '</p>' +
            '<div class="row">' +
              // S186 (the owner's CTA rule — the incident that started the round):
              // Apply is the view's ONE primary (solid teal, the shared bare-button
              // grammar = "Capture an idea"'s style) at the TRAILING end; Cancel is
              // the neutral secondary beside it. Both were .ghost (teal-text outlined)
              // — zero hierarchy, Apply read like Cancel.
              '<button type="button" class="ghost" data-crop-cancel>' + t('sparks.cropCancel', 'Cancel') + '</button>' +
              '<button type="button" data-crop-apply>' + t('sparks.cropApply', 'Apply') + '</button>' +
            '</div>' +
          '</form>'
        document.body.appendChild(dlg)
        const stage = dlg.querySelector('[data-crop-stage]')
        const canvas = dlg.querySelector('[data-crop-canvas]')
        const ctx = canvas.getContext('2d')
        const close = (val) => {
          cancelAnimationFrame(raf)
          try { dlg.close() } catch { /* already closed */ }
          dlg.remove()
          resolve(val)
        }
        const fit = () => {
          const r = stage.getBoundingClientRect()
          canvas.width = Math.max(1, Math.round(r.width))
          canvas.height = Math.max(1, Math.round(r.width / aspect))
          // cover-fit initial transform: the stage starts fully covered, centered
          scale = Math.max(canvas.width / img.width, canvas.height / img.height)
          tx = (canvas.width - img.width * scale) / 2
          ty = (canvas.height - img.height * scale) / 2
          draw()
        }
        const clamp = () => {
          // the image must always COVER the crop window — no gaps past any edge
          const w = img.width * scale, h = img.height * scale
          if (w <= canvas.width) tx = (canvas.width - w) / 2
          else tx = Math.min(0, Math.max(canvas.width - w, tx))
          if (h <= canvas.height) ty = (canvas.height - h) / 2
          else ty = Math.min(0, Math.max(canvas.height - h, ty))
        }
        const draw = () => {
          ctx.save()
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.translate(tx, ty)
          ctx.scale(scale, scale)
          ctx.drawImage(img, 0, 0)
          ctx.restore()
        }
        const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; clamp(); draw() }) }
        // the RO re-RUNS fit (not just draw): fit() before showModal() reads a 0-size
        // stage (the dialog is display:none) and sizes the canvas to 1px — the first
        // real layout after showModal() must re-fit the canvas + the cover transform.
        const ro = new ResizeObserver(() => fit())
        ro.observe(stage)
        fit()

        // drag-to-pan (pointer events — mouse + touch + pen)
        canvas.style.touchAction = 'none'
        canvas.addEventListener('pointerdown', (e) => {
          dragging = { x: e.clientX, y: e.clientY, tx, ty }
          canvas.setPointerCapture(e.pointerId)
          e.preventDefault()
        })
        canvas.addEventListener('pointermove', (e) => {
          if (!dragging) return
          tx = dragging.tx + (e.clientX - dragging.x)
          ty = dragging.ty + (e.clientY - dragging.y)
          schedule()
        })
        const endDrag = () => { dragging = null }
        canvas.addEventListener('pointerup', endDrag)
        canvas.addEventListener('pointercancel', endDrag)
        // wheel-zoom (around the viewport center, then clamp keeps the cover)
        canvas.addEventListener('wheel', (e) => {
          e.preventDefault()
          scale = Math.max(0.05, Math.min(8, scale * Math.exp(-e.deltaY * 0.0015)))
          schedule()
        }, { passive: false })

        dlg.querySelector('[data-crop-cancel]').addEventListener('click', () => close(null))
        dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null) })
        dlg.querySelector('[data-crop-apply]').addEventListener('click', () => {
          // export the visible crop region at native resolution, capped at maxW
          clamp(); draw()
          const sx = -tx / scale, sy = -ty / scale
          const sw = canvas.width / scale, sh = canvas.height / scale
          const outW = Math.min(Math.round(sw), maxW)
          const outH = Math.max(1, Math.round(outW * (sh / sw)))
          const out = document.createElement('canvas')
          out.width = outW
          out.height = outH
          out.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
          let dataUrl = null, finalMime = mimeType
          try {
            dataUrl = out.toDataURL(mimeType, quality)
            if (!dataUrl.startsWith('data:' + mimeType)) {
              finalMime = 'image/png'
              dataUrl = out.toDataURL('image/png')
            }
          } catch {
            finalMime = 'image/png'
            dataUrl = out.toDataURL('image/png')
          }
          close({ dataBase64: dataUrl.split(',')[1], mimeType: finalMime })
        })
        dlg.showModal()
      }
    })
  }

  return { openCrop }
})()
