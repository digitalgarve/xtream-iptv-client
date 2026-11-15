import en from '../src/i18n/locales/en-US.json';
import it from '../src/i18n/locales/it-IT.json';
import de from '../src/i18n/locales/de-DE.json';
import { createI18n, detectLocale, i18n, SUPPORTED_LOCALES } from '../src/i18n/index.js';
import { LANGUAGE_OPTIONS, SettingsService } from '../src/services/settings.js';
import { openAppDb } from '../src/db/appDb.js';

describe('i18n', () => {
  test.each([it, de])('locales have the same keys and interpolation placeholders', (locale) => {
    expect(Object.keys(locale).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(locale[key].trim()).not.toBe('');
      expect((locale[key].match(/\{\w+\}/g) || []).sort()).toEqual((en[key].match(/\{\w+\}/g) || []).sort());
    }
  });

  test('every error code has a message', () => {
    ['AUTH_FAILED', 'NETWORK', 'TIMEOUT', 'UNKNOWN', 'ACCOUNT_EXPIRED'].forEach((code) => {
      expect(en[`error.${code}`]).toBeTruthy();
      expect(it[`error.${code}`]).toBeTruthy();
      expect(de[`error.${code}`]).toBeTruthy();
    });
  });

  test('plurals and interpolation', () => {
    const i18n = createI18n({ locales: { 'en-US': en, 'it-IT': it } });
    expect(i18n.t('detail.seasons', { count: 1 })).toBe('1 season');
    expect(i18n.t('detail.seasons', { count: 3 })).toBe('3 seasons');
    i18n.setLocale('it-IT');
    expect(i18n.t('detail.episodes', { count: 1 })).toBe('1 episodio');
    expect(i18n.t('detail.episodes', { count: 12 })).toBe('12 episodi');
  });

  test('falls back to en-US and then to the key', () => {
    const i18n = createI18n({ locales: { 'en-US': { a: 'A' }, 'it-IT': {} }, locale: 'it-IT' });
    expect(i18n.t('a')).toBe('A');
    expect(i18n.t('missing.key')).toBe('missing.key');
  });

  test('notifies listeners and detects the TV language', () => {
    const i18n = createI18n({ locales: { 'en-US': en, 'it-IT': it } });
    const seen = [];
    i18n.onChange((l) => seen.push(l));
    i18n.setLocale('it-IT');
    i18n.setLocale('it-IT');
    expect(seen).toEqual(['it-IT']);
    expect(detectLocale('it')).toBe('it-IT');
    expect(detectLocale('fr-FR')).toBe('en-US');
  });

  test.each(['de', 'de-DE', 'de-AT', 'de-CH', 'DE-de'])('detects German from %s', (language) => {
    expect(detectLocale(language)).toBe('de-DE');
  });

  test('registered German locale translates plurals and placeholders', () => {
    const previous = i18n.getLocale();
    try {
      expect(SUPPORTED_LOCALES).toContain('de-DE');
      expect(LANGUAGE_OPTIONS).toContain('de-DE');
      i18n.setLocale('de-DE');
      expect(i18n.getLocale()).toBe('de-DE');
      expect(i18n.t('nav.settings')).toBe('Einstellungen');
      expect(i18n.t('detail.seasons', { count: 1 })).toBe('1 Staffel');
      expect(i18n.t('detail.seasons', { count: 3 })).toBe('3 Staffeln');
      expect(i18n.t('detail.episodes', { count: 0 })).toBe('0 Folgen');
      expect(i18n.t('detail.episodes', { count: 1 })).toBe('1 Folge');
      expect(i18n.t('detail.episodes', { count: 12 })).toBe('12 Folgen');
      expect(i18n.t('player.endsAt', { time: '20:15' })).toBe('endet um 20:15');
    } finally {
      i18n.setLocale(previous);
    }
  });

  test('German language survives saving and reopening settings', async () => {
    const db = await openAppDb('german-settings');
    try {
      await new SettingsService(db).update({ language: 'de-DE' });
      expect((await new SettingsService(db).get()).language).toBe('de-DE');
    } finally {
      db.close();
    }
  });
});
