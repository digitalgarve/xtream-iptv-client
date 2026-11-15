import { decodeId } from '../services/catalogUnion.js';

/**
 * The name of one version of a title or channel: its own name when it has one (channels), otherwise its stream id with what the
 * provider's name says it is and the file type: "#1234 · FHD ITA · mkv". With several providers active (`names`: slot → name, more
 * than one) the provider it comes from ends it: "#1234 · FHD · mkv · Provider B".
 */
export function streamLabel(member, names = null) {
  const { slot, id } = decodeId(member.id);
  const base = member.name || [`#${id}`, member.tags && member.tags.length ? member.tags.join(' ') : '', member.ext || ''].filter(Boolean).join(' · ');
  const provider = names && names.size > 1 ? names.get(member.slot || slot) : '';
  return provider ? `${base} · ${provider}` : base;
}

/** slot → provider name of the active providers (`current` of ctx.active.get()). */
export const sourceNames = (current) => new Map(((current && current.sources) || []).map((s) => [s.slot, s.provider.name]));
