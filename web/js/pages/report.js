// Report lost / report found / edit a post: a full page with a live photo preview.
import { state, upsertItem, findItem } from '../state.js';
import { escapeHTML, CATEGORIES, HANDOVER_POINTS, categoryIcon, busy, toast } from '../util.js';
import { preparePhoto, photoFingerprint } from '../photos.js';
import { pageHead, loading, card } from '../components.js';
import { navigate } from '../router.js';

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const PLACES = ['Central Library', 'Library reading hall', 'Lecture theatre complex', 'Academic block', 'Computer centre', 'Main auditorium', 'Cafeteria', 'Sports complex', 'Gym', 'Hostel mess', 'Main gate', 'Parking area', 'Admin block'];

function formMarkup(type, item) {
  const found = type === 'FOUND';
  const value = name => escapeHTML(item?.[name] ?? '');
  const categories = Object.entries(CATEGORIES).map(([key, label]) => [key, `${categoryIcon(key)} ${label}`]);
  return `
    ${item ? '' : `<div class="type-cards" aria-label="Report type">
      <a href="/report/lost" class="type-card${found ? '' : ' active'}"><span>🔍</span><b>I lost something</b><small>We’ll match it against found items</small></a>
      <a href="/report/found" class="type-card${found ? ' active' : ''}"><span>📦</span><b>I found something</b><small>Help it get back to its owner</small></a></div>`}
    <form id="post-form" class="form-card" novalidate>
      <label>${found ? 'What is it? <span class="label-optional">(optional if you pick a category)</span>' : 'What is it?'}
        <input name="title" maxlength="80" value="${value('title')}" placeholder="${found ? 'e.g. Black Casio calculator' : 'e.g. Navy blue water bottle'}"></label>
      <div class="form-row">
      </div>
      <fieldset class="tile-group"><legend>Category</legend>${categories.map(([key, label]) => `<label class="tile"><input type="radio" name="category" value="${key}"${item?.category === key ? ' checked' : ''}><span>${label}</span></label>`).join('')}</fieldset>
      ${found ? `<fieldset class="tile-group"><legend>Where is it now?</legend>${Object.entries(HANDOVER_POINTS).map(([key, label]) => `<label class="tile"><input type="radio" name="handover" value="${key}"${item?.handover === key ? ' checked' : ''}><span>${label}</span></label>`).join('')}</fieldset>` : ''}
      <div class="form-row">
        <label>${found ? 'Where did you find it?' : 'Where did you lose it?'}<input name="location" list="campus-places" maxlength="80" value="${value('location')}" placeholder="e.g. Central Library, 2nd floor"></label>
        <label>When?<input name="occurredOn" type="date" max="${new Date().toISOString().slice(0, 10)}" value="${value('occurredOn')}"></label>
      </div>
      <datalist id="campus-places">${PLACES.map(place => `<option value="${place}">`).join('')}</datalist>
      <label>More details <span class="label-optional">(colour, brand, marks; keep one detail secret so the owner can prove it)</span>
        <textarea name="description" rows="4" maxlength="400">${value('description')}</textarea></label>
      ${item ? '' : `<label class="upload-drop" id="drop-zone"><span class="drop-icon">📷</span>
        <b>${found ? 'Add a photo (required)' : 'Add a photo (optional, improves matching)'}</b><span class="file-hint">Drag a photo here or tap to choose. It is resized on your device and its location data removed.</span>
        <input name="photo" type="file" accept="image/*" class="visually-hidden"></label>`}
      <p id="form-error" class="form-error" role="alert"></p>
      <div class="form-actions">
        <a class="button button-light" href="${item ? `/item/${encodeURIComponent(item.itemId)}` : '/browse'}">Cancel</a>
        <button id="submit-post" class="button button-dark" type="submit">${item ? 'Save changes' : found ? 'Post found item' : 'Post lost item'}</button>
      </div>
    </form>`;
}

function readFields(form, type) {
  const data = new FormData(form);
  const value = name => String(data.get(name) ?? '').trim();
  return {
    itemType: type, title: value('title'), category: value('category'), location: value('location'),
    occurredOn: value('occurredOn') || null, description: value('description'),
    ...(type === 'FOUND' ? { handover: value('handover') || null } : {}),
  };
}

function problemWith(fields, photo, editing) {
  if (fields.itemType === 'LOST' && (!fields.title || !fields.category || !fields.location)) return 'Add what it is, a category and where you lost it.';
  if (fields.itemType === 'FOUND' && !fields.title && !fields.category) return 'Add either a short name or a category.';
  if (!editing && fields.itemType === 'FOUND' && !photo) return 'Add a photo of the item you found.';
  if (photo && (!photo.type.startsWith('image/') || photo.size > MAX_INPUT_BYTES)) return 'Choose a photo up to 25 MB.';
  return null;
}

export async function renderReport(view, params) {
  let item = null;
  if (params.id) {
    view.innerHTML = loading('Loading post…');
    item = findItem(params.id) ?? await state.backend.getItem(params.id).catch(() => null);
    if (!item?.mine) { toast('You can only edit your own posts.'); navigate('/profile', { replace: true }); return; }
  }
  const type = item?.itemType ?? (params.type === 'found' ? 'FOUND' : 'LOST');

  view.innerHTML = `${pageHead(item ? 'EDIT POST' : 'REPORT', item ? 'Edit your post' : type === 'FOUND' ? 'Report a found item' : 'Report a lost item',
    item ? 'Fix a detail or add information. Existing chats stay open.'
      : type === 'FOUND' ? 'Thank you for handing it in. Add a photo and say where the item is now.' : 'The more specific you are, the better the matches.')}
    <div class="report-layout"><div class="report-main">${formMarkup(type, item)}</div>
      <aside class="report-side"><div class="eyebrow">LIVE PREVIEW</div><div id="live-preview"></div>
      <div class="tips"><h3>Tips</h3><ul class="checklist">
        <li>Name the exact place: “LT-3, row 5” beats “lecture hall”.</li>
        <li>${type === 'FOUND' ? 'Hand valuables to the security office and choose it above.' : 'A photo of the same model helps the matching.'}</li>
        <li>Keep one detail out of the post so the real owner can prove it in chat.</li>
      </ul></div></aside></div>`;

  const form = view.querySelector('#post-form');
  let photoUrl = item?.imageUrl ?? null;
  const preview = () => {
    const fields = readFields(form, type);
    view.querySelector('#live-preview').innerHTML = card({
      ...item, ...fields, itemId: item?.itemId ?? 'preview', status: 'ACTIVE', mine: true, createdAt: item?.createdAt ?? new Date().toISOString(),
      imageUrl: photoUrl, hasPhoto: Boolean(photoUrl), seed: false,
    }).replace(/<a class="card-link"[^>]*><\/a>/, '');
  };
  const usePhoto = file => {
    if (!file) return;
    if (photoUrl && !item) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(file);
    view.querySelector('#drop-zone').classList.add('has-photo');
    view.querySelector('#drop-zone b').textContent = `✓ ${file.name}`;
    preview();
  };
  form.addEventListener('input', preview);
  form.elements.photo?.addEventListener('change', () => usePhoto(form.elements.photo.files[0]));
  const zone = view.querySelector('#drop-zone');
  zone?.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('dragging'); });
  zone?.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone?.addEventListener('drop', event => {
    event.preventDefault();
    zone.classList.remove('dragging');
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const files = new DataTransfer();
    files.items.add(file);
    form.elements.photo.files = files.files;
    usePhoto(file);
  });
  preview();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const fields = readFields(form, type);
    const picked = form.elements.photo?.files[0] ?? null;
    const problem = problemWith(fields, picked, Boolean(item));
    if (problem) { view.querySelector('#form-error').textContent = problem; return; }
    await busy(view.querySelector('#submit-post'), picked ? 'Uploading…' : 'Saving…', async () => {
      try {
        let saved;
        if (item) {
          const { itemType, ...changes } = fields;
          saved = await state.backend.editPost(item.itemId, changes);
          toast('Changes saved.');
        } else {
          const photo = picked ? await preparePhoto(picked) : null;
          const visualHash = photo ? await photoFingerprint(photo).catch(() => null) : null;
          saved = await state.backend.createPost({ fields, photo, visualHash });
          toast(photo ? 'Posted. Your photo is being checked; matches will be ready in a few seconds.' : 'Posted to the campus board.');
        }
        upsertItem(saved);
        navigate(`/item/${encodeURIComponent(saved.itemId)}`);
      } catch (error) {
        view.querySelector('#form-error').textContent = error.message;
      }
    });
  });
}
