/**
 * JAPT Photos - photos on a task: adding them in a note, showing them, and looking at one full screen.
 *
 * Responsibilities:
 *   - The note field with its photos: a camera button inside the field, the photos as a row under the text,
 *     a × to take one off. Adding also by pasting (Cmd+V) anywhere in the form, or dropping a file on the
 *     note. Nothing is saved here: the form saves the photos with the task (Store, photos in the fields)
 *   - Making a photo smaller before it is stored (config.js, photoMaxSide and photoQuality); drawing it
 *     again as a JPEG also leaves out what a camera writes into a photo, such as where it was taken
 *   - A photo is read only when it is shown, once per session (url)
 *   - The small mark on a chip in the planning that says it has photos; the task card shows the photos
 *   - Full screen: one photo at a time, with the others by arrows, keys or swiping
 *
 * What it looks like and why is in docs/design.md, Photos.
 */

const Photos = (() => {
  const { esc, html } = UI;
  const icon = (size, stroke, shapes) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
    + `${shapes}</svg>`;
  const CAMERA = icon(18, 2, '<path d="M12 20H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1a2 2 0 0 0 2-2 1 1 0 0 1 1-1h6a1 1 0 0 1 1 1 '
    + '2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v3.5"/><path d="M16 19h6M19 16v6"/><circle cx="12" cy="13" r="3"/>');
  const PICTURE = icon(13, 2.2, '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/>'
    + '<path d="M21 16l-5-5-9 9"/>');
  const SWIPE_PX = 50;   // a horizontal move this long is a swipe to the next photo, shorter is a tap

  /* ---------- reading ---------- */

  // id -> Promise of an address the browser can show, or null when the photo is gone. Once per session.
  const urls = new Map();
  function url(id) {
    if (!urls.has(id)) {
      const p = Store.photo(id).then(blob => (blob ? URL.createObjectURL(blob) : null));
      p.catch(() => urls.delete(id));   // not read (no connection): try again next time it is shown
      urls.set(id, p);
    }
    return urls.get(id);
  }
  // Puts the photos into the <img> elements under el that wait for one (data-src).
  function fill(el) {
    el.querySelectorAll('img[data-src]').forEach(async img => {
      const id = img.dataset.src;
      img.removeAttribute('data-src');
      try {
        const src = await url(id);
        if (src) img.src = src; else img.closest('.phw').classList.add('gone');
      } catch (e) {
        console.error('Photo not read', e);
        img.closest('.phw').classList.add('gone');
      }
    });
  }

  /* ---------- showing ---------- */

  // One photo in a row; the proportions are known before it is read, so nothing jumps.
  const thumbHtml = (p, removable) => html`
    <span class="phw" data-phid="${p.id}">
      <button type="button" class="pht" data-phopen="${p.id}" title="${t('photo.open')}"
        style="--ratio:${p.width}/${p.height}"><img alt="" draggable="false"
        ${p.url ? `src="${p.url}"` : `data-src="${p.id}"`}></button>
      ${removable ? `<button type="button" class="phx" data-phx="${p.id}" title="${t('photo.remove')}">×</button>` : ''}
    </span>`;
  // On a card the photos are small squares; in the form (removable) larger, in their own proportions.
  const rowHtml = (list, removable) => (list.length
    ? `<div class="phrow ${removable ? 'edit' : ''}">${list.map(p => thumbHtml(p, removable)).join('')}</div>` : '');

  // The photos of a task for the task card, or '' without photos. Call fill(card) once it is in the page.
  const cardHtml = taskId => rowHtml(Store.photosOf(taskId), false);

  // The mark in the planning: the task has photos.
  const mark = k => (Store.photosOf(k.id).length ? `<span class="phm" title="${t('photo.has')}">${PICTURE}</span>` : '');

  /* ---------- full screen ---------- */

  // list: [{id, url?}], the photos to page through; at: the one to start with.
  function view(list, at) {
    if (!list.length) return;
    const many = list.length > 1;
    const dlg = UI.dialog({ cls: 'photoview', closeOutside: () => true });
    dlg.innerHTML = html`
      <img alt="">
      <button type="button" class="pvx" title="${t('photo.close')}">×</button>
      ${many ? `<button type="button" class="pvprev" title="${t('photo.prev')}">‹</button>
                <button type="button" class="pvnext" title="${t('photo.next')}">›</button>
                <div class="pvcount"></div>` : ''}`;
    const img = dlg.querySelector('img');
    let i = at;
    async function show(n) {
      i = (n + list.length) % list.length;
      const p = list[i];
      img.removeAttribute('src');
      if (many) dlg.querySelector('.pvcount').textContent = `${i + 1} / ${list.length}`;
      try {
        const src = p.url || await url(p.id);
        if (list[i] === p) { if (src) img.src = src; else UI.toast(t('photo.gone')); }
      } catch (e) {
        console.error('Photo not read', e);
        UI.toast(t('photo.not_read'));
      }
    }
    dlg.querySelector('.pvx').onclick = () => dlg.close();
    if (many) {
      dlg.querySelector('.pvprev').onclick = () => show(i - 1);
      dlg.querySelector('.pvnext').onclick = () => show(i + 1);
      dlg.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft') show(i - 1);
        if (e.key === 'ArrowRight') show(i + 1);
      });
      let startX = null;
      dlg.addEventListener('touchstart', e => { startX = e.touches.length === 1 ? e.touches[0].clientX : null; });
      dlg.addEventListener('touchend', e => {
        if (startX === null) return;
        const dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > SWIPE_PX) show(i + (dx < 0 ? 1 : -1));
        startX = null;
      });
    }
    show(at);
  }

  // Escape closes the photo on top first, not what lies under it (the task card). Registered before the
  // calendar's, so it is asked first (UI.onEscape).
  UI.onEscape(() => {
    const open = document.querySelector('dialog.photoview');
    if (open) open.close();
    return !!open;
  });

  // A click on a photo in a row opens it full screen, with the other photos of that row to page through.
  document.addEventListener('click', e => {
    const open = e.target.closest('[data-phopen]');
    if (!open) return;
    const row = open.closest('.phrow');
    const list = [...row.querySelectorAll('.phw:not(.gone)')].map(w => {
      const img = w.querySelector('img');
      return { id: w.dataset.phid, url: img && img.src && img.src.startsWith('blob:') ? img.src : null };
    });
    view(list, Math.max(0, list.findIndex(p => p.id === open.dataset.phopen)));
  });

  /* ---------- making smaller ---------- */

  const toBase64 = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  // An image file -> {id, data (JPEG as base64), width, height, url}. A transparent part (a screenshot,
  // a PNG) becomes white, as JPEG has no transparency.
  async function shrink(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = Model.fitWithin(bitmap.width, bitmap.height, JAPT_CONFIG.photoMaxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const cx = canvas.getContext('2d');
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, width, height);
    cx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JAPT_CONFIG.photoQuality));
    if (!blob) throw new Error('No JPEG made');
    return { id: newId(), data: await toBase64(blob), width, height, url: URL.createObjectURL(blob) };
  }

  /* ---------- the note field ---------- */

  // The note with its photos, in place of a plain note field. id/name: of the textarea.
  function noteFieldHtml({ id = '', name = '', value = '', rows = 3, cls = 'f' }) {
    const attrs = `${id ? `id="${id}"` : ''} ${name ? `name="${name}"` : ''}`;
    return html`
      <div class="${cls}">
        <span class="fl">${t('form.note')}</span>
        <div class="notebox">
          <textarea ${attrs} rows="${rows}" aria-label="${t('form.note_label')}">${esc(value)}</textarea>
          <div class="notefoot">
            <div class="phslot"></div>
            <button type="button" class="phadd" title="${t('photo.add')}" aria-label="${t('photo.add')}">${CAMERA}</button>
            <input type="file" accept="image/*" multiple hidden data-phpick>
            <input type="file" accept="image/*" capture="environment" hidden data-phtake>
          </div>
        </div>
      </div>`;
  }

  // On a phone or tablet the camera button asks JAPT's own question, the same on every phone: what Android or
  // iOS offers for "an image" differs per version, and a recent Android offers no camera at all. On a computer
  // there is no camera: the button opens the files at once.
  const TOUCH = () => matchMedia('(pointer: coarse)').matches;
  let choice = null;   // the open choice under a camera button, made when it opens and removed when it closes
  function closeChoice() {
    if (!choice) return false;
    choice.remove(); choice = null;
    return true;
  }
  function openChoice(field) {
    if (closeChoice()) return;
    choice = document.createElement('div');
    choice.className = 'phchoice';
    choice.innerHTML = `<button type="button" data-phc="take">${t('photo.take')}</button>`
      + `<button type="button" data-phc="pick">${t('photo.pick')}</button>`;
    choice.onclick = e => {
      const b = e.target.closest('[data-phc]');
      if (!b) return;
      closeChoice();
      field.querySelector(b.dataset.phc === 'take' ? '[data-phtake]' : '[data-phpick]').click();
    };
    field.querySelector('.notefoot').append(choice);
  }
  UI.onEscape(closeChoice);
  document.addEventListener('click', e => {
    if (choice && !e.target.closest('.phchoice, .phadd')) closeChoice();
  });

  // Makes a note field (noteFieldHtml) work for a task: its photos, and what is added and taken off.
  // pasteArea: where pasting an image adds it (the whole form). Returns:
  //   changes()  -> {add, remove} for the Store, after ready()
  //   ready()    -> waits until photos being made smaller are done
  //   saved()    -> after a save went through: the added photos are shown from memory from now on
  //   reset(id)  -> empty again, for a next task (the Inbox)
  function editor(field, pasteArea, taskId) {
    const box = field.querySelector('.notebox'), slot = field.querySelector('.phslot');
    const input = field.querySelector('[data-phpick]');
    let current = taskId, added = [], removed = new Set(), working = [];

    const shown = () => [
      ...(current ? Store.photosOf(current).filter(p => !removed.has(p.id)) : []),
      ...added
    ];
    function draw() {
      slot.innerHTML = rowHtml(shown(), true);
      fill(slot);
    }
    function addFiles(files) {
      const images = [...files].filter(f => f.type.startsWith('image/'));
      if (images.length < files.length) UI.toast(t('photo.only_images'));   // a pdf, a document: not taken
      images.forEach(file => {
        const job = shrink(file)
          .then(p => { added.push(p); draw(); })
          .catch(e => { console.error('Image not read', e); UI.toast(t('photo.unreadable')); });
        working.push(job);
      });
      return images.length > 0;
    }

    field.querySelector('.phadd').onclick = () => (TOUCH() ? openChoice(field) : input.click());
    field.querySelectorAll('input[type=file]').forEach(el => {
      el.onchange = () => { addFiles(el.files); el.value = ''; };
    });
    slot.addEventListener('click', e => {
      const x = e.target.closest('[data-phx]');
      if (!x) return;
      const id = x.dataset.phx, a = added.find(p => p.id === id);
      if (a) { added = added.filter(p => p !== a); URL.revokeObjectURL(a.url); } else removed.add(id);
      draw();
    });
    pasteArea.addEventListener('paste', e => {
      const files = e.clipboardData ? e.clipboardData.files : [];
      if (files.length) { addFiles(files); e.preventDefault(); }   // text is pasted as always
    });
    const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    box.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); box.classList.add('drop'); } });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', e => {
      box.classList.remove('drop');
      if (hasFiles(e)) { e.preventDefault(); addFiles(e.dataTransfer.files); }
    });
    draw();

    return {
      ready: () => Promise.all(working),
      // A photo that is already stored (a save that got no answer, then a reload) isn't sent again.
      changes() {
        const stored = new Set(current ? Store.photosOf(current).map(p => p.id) : []);
        return {
          add: added.filter(p => !stored.has(p.id)).map(({ id, data, width, height }) => ({ id, data, width, height })),
          remove: [...removed]
        };
      },
      saved() {
        added.forEach(p => urls.set(p.id, Promise.resolve(p.url)));
        added = []; removed = new Set();
      },
      reset(id = null) {
        added.forEach(p => URL.revokeObjectURL(p.url));
        current = id; added = []; removed = new Set(); working = [];
        draw();
      }
    };
  }

  return { noteFieldHtml, editor, cardHtml, fill, mark, view };
})();
