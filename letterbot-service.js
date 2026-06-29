const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DREAM_LETTER_BOT_URL = 'https://www.dream-singles.com/members/messaging/bot/';
const LETTERBOT_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const LETTERBOT_MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const letterBotRunsInFlight = new Map();

function defaultLetterBotConfig() {
  return {
    enabled: false,
    intervalMinutes: 20,
    queueIndex: 0,
    lastRunAt: '',
    lastSuccessAt: '',
    lastError: '',
    nextRunAt: '',
    entries: []
  };
}

function normalizeLetterBotConfig(raw) {
  const base = defaultLetterBotConfig();
  if (!raw || typeof raw !== 'object') return base;
  const entries = Array.isArray(raw.entries)
    ? raw.entries.map(item => ({
      id: String(item?.id || crypto.randomUUID()),
      text: String(item?.text || ''),
      mediaType: ['none', 'photo', 'video'].includes(String(item?.mediaType || '')) ? String(item.mediaType) : 'none',
      mediaName: String(item?.mediaName || ''),
      mediaMime: String(item?.mediaMime || ''),
      mediaFile: String(item?.mediaFile || '')
    })).filter(item => item.text.trim() || item.mediaType !== 'none')
    : [];
  return {
    ...base,
    enabled: raw.enabled === true,
    intervalMinutes: Math.min(240, Math.max(5, Number(raw.intervalMinutes) || 20)),
    queueIndex: Math.max(0, Number(raw.queueIndex) || 0),
    lastRunAt: String(raw.lastRunAt || ''),
    lastSuccessAt: String(raw.lastSuccessAt || ''),
    lastError: String(raw.lastError || ''),
    nextRunAt: String(raw.nextRunAt || ''),
    entries
  };
}

function letterBotMediaDir(mediaRoot, profileId) {
  const safeId = String(profileId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(mediaRoot, safeId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function letterBotMediaPath(mediaRoot, profileId, entryId, ext) {
  const safeEntry = String(entryId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(letterBotMediaDir(mediaRoot, profileId), `${safeEntry}.${ext}`);
}

function publicLetterBotEntry(entry, profileId, mediaRoot) {
  const item = {
    id: entry.id,
    text: entry.text,
    mediaType: entry.mediaType,
    mediaName: entry.mediaName,
    mediaMime: entry.mediaMime,
    hasMedia: false,
    mediaUrl: ''
  };
  if (entry.mediaFile && entry.mediaType !== 'none') {
    const absolute = path.join(mediaRoot, entry.mediaFile);
    if (fs.existsSync(absolute)) {
      item.hasMedia = true;
      item.mediaUrl = `/letterbot-media/${profileId}/${path.basename(absolute)}`;
    }
  }
  return item;
}

function publicLetterBotConfig(profile, profileId, mediaRoot) {
  const config = normalizeLetterBotConfig(profile?.letterBot);
  return {
    enabled: config.enabled,
    intervalMinutes: config.intervalMinutes,
    queueIndex: config.queueIndex,
    lastRunAt: config.lastRunAt,
    lastSuccessAt: config.lastSuccessAt,
    lastError: config.lastError,
    nextRunAt: config.nextRunAt,
    entries: config.entries.map(entry => publicLetterBotEntry(entry, profileId, mediaRoot))
  };
}

function parseLetterBotDataUrl(value, mediaType) {
  const text = String(value || '');
  if (mediaType === 'photo') {
    const match = text.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) return null;
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > LETTERBOT_MAX_PHOTO_BYTES) return null;
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    return { buffer, ext, mime: `image/${match[1] === 'jpg' ? 'jpeg' : match[1]}` };
  }
  if (mediaType === 'video') {
    const match = text.match(/^data:video\/(mp4|webm);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match || match[1].toLowerCase() !== 'mp4') return null;
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > LETTERBOT_MAX_VIDEO_BYTES) return null;
    return { buffer, ext: 'mp4', mime: 'video/mp4' };
  }
  return null;
}

function saveLetterBotMedia(mediaRoot, profileId, entryId, dataUrl, mediaType, mediaName = '') {
  const parsed = parseLetterBotDataUrl(dataUrl, mediaType);
  if (!parsed) throw new Error(mediaType === 'video' ? 'Use MP4 video up to 100 MB' : 'Use JPG, PNG or WebP up to 8 MB');
  const filePath = letterBotMediaPath(mediaRoot, profileId, entryId, parsed.ext);
  fs.writeFileSync(filePath, parsed.buffer);
  const relative = path.join(String(profileId).replace(/[^a-zA-Z0-9_-]/g, '_'), `${String(entryId).replace(/[^a-zA-Z0-9_-]/g, '_')}.${parsed.ext}`);
  return {
    mediaFile: relative.replace(/\\/g, '/'),
    mediaMime: parsed.mime,
    mediaName: String(mediaName || `media.${parsed.ext}`).slice(0, 180),
    absolutePath: filePath
  };
}

function deleteLetterBotMedia(mediaRoot, entry) {
  if (!entry?.mediaFile) return;
  const absolute = path.join(mediaRoot, entry.mediaFile);
  if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
}

function pickLetterBotEntry(config) {
  const entries = (config.entries || []).filter(item => String(item.text || '').trim());
  if (!entries.length) return null;
  const index = config.queueIndex % entries.length;
  const entry = entries[index];
  return { entry, index, total: entries.length };
}

function scheduleLetterBotNext(profile, success = true) {
  const config = normalizeLetterBotConfig(profile.letterBot);
  const now = new Date();
  config.lastRunAt = now.toISOString();
  if (success) {
    config.lastSuccessAt = config.lastRunAt;
    config.lastError = '';
    const picked = pickLetterBotEntry(config);
    if (picked) config.queueIndex = (picked.index + 1) % picked.total;
  }
  const next = new Date(now.getTime() + config.intervalMinutes * 60_000);
  config.nextRunAt = next.toISOString();
  profile.letterBot = config;
  return config;
}

function profileLetterBotUser(db, profileId, currentAssignedUserForProfile) {
  const profile = db.profiles?.[profileId];
  if (!profile) return null;
  const assignee = typeof currentAssignedUserForProfile === 'function'
    ? currentAssignedUserForProfile(db, profileId)
    : null;
  if (assignee?.id && db.users?.[assignee.id]) return db.users[assignee.id];
  const ownerId = String(profile.ownerAdminId || '');
  if (ownerId && db.users?.[ownerId]) return db.users[ownerId];
  return Object.values(db.users || {}).find(user => (user.profileIds || []).includes(profileId)) || null;
}

async function runLetterBotOnPage(page, entry, mediaAbsolutePath) {
  await page.goto(DREAM_LETTER_BOT_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.cke_wysiwyg_frame', { timeout: 45_000 });
  const editor = page.frameLocator('.cke_wysiwyg_frame.cke_reset').first();
  await editor.locator('body').click({ timeout: 10_000 }).catch(() => {});
  const paragraph = editor.locator('p').first();
  await paragraph.click({ timeout: 10_000 }).catch(() => {});
  await paragraph.fill(String(entry.text || '').trim(), { timeout: 15_000 });

  if (entry.mediaType === 'video' && mediaAbsolutePath) {
    let attached = false;
    const directVideo = page.locator('#bot_video');
    if (await directVideo.count()) {
      await directVideo.setInputFiles(mediaAbsolutePath);
      attached = true;
    }
    if (!attached) {
      await page.locator('a, button, [data-toggle="tab"], .nav-link').filter({ hasText: /boomerang|video/i }).first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const input = page.locator('input[type="file"]').first();
      if (await input.count()) {
        await input.setInputFiles(mediaAbsolutePath);
        attached = true;
      }
    }
    if (!attached) throw new Error('Could not attach video on Letter Sendout page');
  } else if (entry.mediaType === 'photo' && mediaAbsolutePath) {
    await page.locator('a, button, [data-toggle="tab"], .nav-link').filter({ hasText: /attach photo|photo/i }).first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const input = page.locator('input[type="file"]').first();
    if (!(await input.count())) throw new Error('Could not find photo upload on Letter Sendout page');
    await input.setInputFiles(mediaAbsolutePath);
  }

  await page.waitForTimeout(1500);
  const saveButton = page.locator('#bot_save');
  if (!(await saveButton.count())) throw new Error('Save button was not found on Letter Sendout page');
  await saveButton.click({ timeout: 15_000 });
  await page.waitForTimeout(2500);
}

async function runLetterBotNow(deps, profileId, options = {}) {
  const id = String(profileId || '');
  if (!id) throw new Error('Profile id is required');
  if (letterBotRunsInFlight.has(id)) throw new Error('LetterBot is already running for this profile');
  letterBotRunsInFlight.set(id, true);
  try {
    const db = deps.readDb();
    const profile = db.profiles?.[id];
    if (!profile || profile.active === false) throw new Error('Profile not found');
    const config = normalizeLetterBotConfig(profile.letterBot);
    const picked = pickLetterBotEntry(config);
    if (!picked) throw new Error('Add at least one letter text');
    const entry = picked.entry;
    if (!deps.dreamSessions.has(id)) throw new Error('Profile is not connected on the server');

    const user = profileLetterBotUser(db, id, deps.currentAssignedUserForProfile);
    if (!user) throw new Error('No operator is assigned to this profile');

    let mediaAbsolutePath = '';
    if (entry.mediaType !== 'none' && entry.mediaFile) {
      mediaAbsolutePath = path.join(deps.letterBotMediaRoot, entry.mediaFile);
      if (!fs.existsSync(mediaAbsolutePath)) throw new Error('Letter media file is missing. Upload it again.');
    } else if (entry.mediaType !== 'none') {
      throw new Error('This letter requires a photo or video file');
    }

    let browserSession = deps.dreamBrowserSessions.get(id);
    if (!browserSession?.page) {
      browserSession = await deps.startDreamBrowser(db, user, id, { force: false, headless: true });
    }
    const page = browserSession.page;
    await runLetterBotOnPage(page, entry, mediaAbsolutePath);

    scheduleLetterBotNext(profile, true);
    if (options.enable === true) profile.letterBot.enabled = true;
    profile.updatedAt = new Date().toISOString();
    deps.writeDb(db);
    return publicLetterBotConfig(profile, id, deps.letterBotMediaRoot);
  } catch (error) {
    const db = deps.readDb();
    const profile = db.profiles?.[id];
    if (profile) {
      const config = normalizeLetterBotConfig(profile.letterBot);
      config.lastRunAt = new Date().toISOString();
      config.lastError = error.message || 'LetterBot failed';
      profile.letterBot = config;
      profile.updatedAt = new Date().toISOString();
      deps.writeDb(db);
    }
    throw error;
  } finally {
    letterBotRunsInFlight.delete(id);
  }
}

async function maybeRunLetterBot(deps, profileId) {
  const id = String(profileId || '');
  const db = deps.readDb();
  const profile = db.profiles?.[id];
  if (!profile || profile.active === false) return false;
  const config = normalizeLetterBotConfig(profile.letterBot);
  if (!config.enabled) return false;
  if (!deps.dreamSessions.has(id)) return false;
  if (letterBotRunsInFlight.has(id)) return false;
  const now = Date.now();
  if (config.nextRunAt && new Date(config.nextRunAt).getTime() > now) return false;
  if (!config.nextRunAt && config.lastSuccessAt) {
    const last = new Date(config.lastSuccessAt).getTime();
    if (now - last < config.intervalMinutes * 60_000) return false;
  }
  await runLetterBotNow(deps, id, {});
  return true;
}

function registerLetterBotRoutes(app, deps) {
  const { requireUser, requireProfileForUser, readDb, writeDb, letterBotMediaRoot } = deps;

  app.get('/api/profiles/:id/letterbot', requireUser, (req, res) => {
    const db = readDb();
    const id = String(req.params.id);
    try {
      requireProfileForUser(db, req.user, id);
      const profile = db.profiles[id];
      res.json({ ok: true, letterbot: publicLetterBotConfig(profile, id, letterBotMediaRoot) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not load LetterBot' });
    }
  });

  app.put('/api/profiles/:id/letterbot', requireUser, (req, res) => {
    const db = readDb();
    const id = String(req.params.id);
    try {
      const profile = requireProfileForUser(db, req.user, id);
      const current = normalizeLetterBotConfig(profile.letterBot);
      const incomingEntries = Array.isArray(req.body?.entries) ? req.body.entries : current.entries;
      const entries = incomingEntries.map(item => {
        const entryId = String(item?.id || crypto.randomUUID());
        const existing = current.entries.find(row => row.id === entryId);
        const mediaType = ['none', 'photo', 'video'].includes(String(item?.mediaType || ''))
          ? String(item.mediaType)
          : (existing?.mediaType || 'none');
        const next = {
          id: entryId,
          text: String(item?.text || ''),
          mediaType,
          mediaName: existing?.mediaName || '',
          mediaMime: existing?.mediaMime || '',
          mediaFile: existing?.mediaFile || ''
        };
        if (mediaType === 'none') {
          if (existing?.mediaFile) deleteLetterBotMedia(letterBotMediaRoot, existing);
          next.mediaName = '';
          next.mediaMime = '';
          next.mediaFile = '';
        }
        return next;
      }).filter(item => item.text.trim() || item.mediaType !== 'none');
      profile.letterBot = {
        ...current,
        intervalMinutes: Math.min(240, Math.max(5, Number(req.body?.intervalMinutes) || current.intervalMinutes || 20)),
        entries
      };
      profile.updatedAt = new Date().toISOString();
      writeDb(db);
      res.json({ ok: true, letterbot: publicLetterBotConfig(profile, id, letterBotMediaRoot) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not save LetterBot' });
    }
  });

  app.post('/api/profiles/:id/letterbot/media', requireUser, (req, res) => {
    const db = readDb();
    const id = String(req.params.id);
    try {
      const profile = requireProfileForUser(db, req.user, id);
      const config = normalizeLetterBotConfig(profile.letterBot);
      const entryId = String(req.body?.entryId || '');
      const mediaType = String(req.body?.mediaType || '');
      if (!entryId) return res.status(400).json({ ok: false, error: 'Entry id is required' });
      if (!['photo', 'video'].includes(mediaType)) return res.status(400).json({ ok: false, error: 'Media type must be photo or video' });
      const durationSec = Number(req.body?.durationSec || 0);
      if (mediaType === 'video' && (!durationSec || durationSec > 3.05)) {
        return res.status(400).json({ ok: false, error: 'Dream Singles allows videos up to 3 seconds only' });
      }
      let entry = config.entries.find(item => item.id === entryId);
      if (!entry) {
        entry = { id: entryId, text: '', mediaType: 'none', mediaName: '', mediaMime: '', mediaFile: '' };
        config.entries.push(entry);
      }
      if (entry.mediaFile) deleteLetterBotMedia(letterBotMediaRoot, entry);
      const saved = saveLetterBotMedia(
        letterBotMediaRoot,
        id,
        entryId,
        String(req.body?.dataUrl || ''),
        mediaType,
        String(req.body?.name || '')
      );
      entry.mediaType = mediaType;
      entry.mediaFile = saved.mediaFile;
      entry.mediaMime = saved.mediaMime;
      entry.mediaName = saved.mediaName;
      profile.letterBot = config;
      profile.updatedAt = new Date().toISOString();
      writeDb(db);
      res.json({ ok: true, entry: publicLetterBotEntry(entry, id, letterBotMediaRoot) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not save media' });
    }
  });

  app.delete('/api/profiles/:id/letterbot/media/:entryId', requireUser, (req, res) => {
    const db = readDb();
    const id = String(req.params.id);
    const entryId = String(req.params.entryId || '');
    try {
      const profile = requireProfileForUser(db, req.user, id);
      const config = normalizeLetterBotConfig(profile.letterBot);
      const entry = config.entries.find(item => item.id === entryId);
      if (entry?.mediaFile) deleteLetterBotMedia(letterBotMediaRoot, entry);
      if (entry) {
        entry.mediaType = 'none';
        entry.mediaFile = '';
        entry.mediaMime = '';
        entry.mediaName = '';
      }
      profile.letterBot = config;
      profile.updatedAt = new Date().toISOString();
      writeDb(db);
      res.json({ ok: true });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not remove media' });
    }
  });

  app.post('/api/profiles/:id/letterbot/start', requireUser, async (req, res) => {
    const id = String(req.params.id);
    try {
      const db = readDb();
      const profile = requireProfileForUser(db, req.user, id);
      const config = normalizeLetterBotConfig(profile.letterBot);
      if (!pickLetterBotEntry(config)) return res.status(400).json({ ok: false, error: 'Add at least one letter text' });
      config.enabled = true;
      config.nextRunAt = new Date().toISOString();
      profile.letterBot = config;
      profile.updatedAt = new Date().toISOString();
      writeDb(db);
      const letterbot = await runLetterBotNow(deps, id, { enable: true });
      res.json({ ok: true, letterbot });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not start LetterBot' });
    }
  });

  app.post('/api/profiles/:id/letterbot/stop', requireUser, (req, res) => {
    const db = readDb();
    const id = String(req.params.id);
    try {
      const profile = requireProfileForUser(db, req.user, id);
      const config = normalizeLetterBotConfig(profile.letterBot);
      config.enabled = false;
      profile.letterBot = config;
      profile.updatedAt = new Date().toISOString();
      writeDb(db);
      res.json({ ok: true, letterbot: publicLetterBotConfig(profile, id, letterBotMediaRoot) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not stop LetterBot' });
    }
  });

  app.post('/api/profiles/:id/letterbot/send-now', requireUser, async (req, res) => {
    const id = String(req.params.id);
    try {
      const letterbot = await runLetterBotNow(deps, id, {});
      res.json({ ok: true, letterbot });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message || 'Could not send letter' });
    }
  });
}

function startLetterBotScheduler(deps) {
  setInterval(() => {
    try {
      const db = deps.readDb();
      for (const profileId of Object.keys(db.profiles || {})) {
        maybeRunLetterBot(deps, profileId).catch(error => {
          console.warn(`[letterbot] ${profileId}: ${error.message || error}`);
        });
      }
    } catch (error) {
      console.warn('[letterbot] scheduler failed', error.message || error);
    }
  }, 60_000).unref?.();
}

module.exports = {
  defaultLetterBotConfig,
  normalizeLetterBotConfig,
  publicLetterBotConfig,
  registerLetterBotRoutes,
  startLetterBotScheduler,
  maybeRunLetterBot,
  runLetterBotNow
};
