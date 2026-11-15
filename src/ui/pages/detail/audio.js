import { createSelectField } from '../../atoms/selectField.js';
import { t } from '../../../i18n/index.js';
import { audioLanguage, audioLabel } from '../../../services/playerController.js';
import { readAudioTracks } from '../../../services/audioTracks.js';

/** Audio choices for the exact movie version / next episode shown on the detail page. */
export function createDetailAudio(ctx) {
  let key = '';
  let controller = null;
  let pending = null;
  let choices = [];
  let selected = '';
  let episode = '';
  const field = createSelectField({
    id: 'detailAudio', label: t('detail.audio'), text: '',
    async onOpen() {
      const current = controller;
      await pending;
      if (controller !== current || !choices.length) return;
      const value = await ctx.dialogs.choose({
        title: `${t('detail.audio')}${episode}`,
        options: [{ label: t('settings.language.auto'), value: '' }, ...choices],
        selected,
      });
      if (controller !== current || value === null) return;
      selected = value;
      show();
    },
  });
  let unknown = false;
  function show() {
    const chosen = choices.find((choice) => choice.value === selected);
    const names = choices.map((choice) => choice.label);
    if (unknown || !names.length) names.push(t('detail.audio.unknown'));
    field.setText(`${chosen ? chosen.label : names.join(' · ')}${episode}`);
  }
  return {
    ...field,
    update(type, target) {
      const next = `${type}:${target.id}:${target.ext || ''}`;
      if (next === key) return;
      key = next;
      if (controller) controller.abort();
      controller = new AbortController();
      const current = controller;
      choices = [];
      selected = '';
      unknown = false;
      episode = type === 'series' ? ` (S${target.season}E${target.number})` : '';
      field.setText(`${t('detail.audio.loading')}${episode}`);
      pending = (async () => {
        const timer = setTimeout(() => current.abort(), 15000);
        try {
          const { client } = await ctx.active.get();
          if (current.signal.aborted) return;
          const tracks = await readAudioTracks(client.streamUrl(type, target.id, target.ext), (url, init) => (ctx.fetch || fetch)(url, { ...init, signal: current.signal }));
          if (controller !== current) return;
          unknown = !tracks || tracks.some((track) => !audioLanguage(track));
          choices = Array.from(new Map((tracks || []).filter((track) => audioLanguage(track)).map((track) => [audioLanguage(track), { label: audioLabel(track, 0, ''), value: audioLanguage(track) }])).values());
        } catch {
          if (controller === current) unknown = true;
        } finally {
          clearTimeout(timer);
          if (controller === current) show();
        }
      })();
    },
    selectionFor(type, target) {
      return key === `${type}:${target.id}:${target.ext || ''}` ? selected : '';
    },
    stop() {
      if (controller) controller.abort();
      controller = null;
    },
  };
}
