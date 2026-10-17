/**
 * Persistence for the editable Ideal DNA.
 *
 * Only the editor payload is stored; the generated DNA is always rebuilt from the current profile
 * and database. A profile fingerprint makes an old edit fail closed when the questionnaire changes.
 * Storage access is guarded so the same module can be imported during SSR verification.
 */

import {EDITABLE_DNA_SCHEMA_VERSION, profileFingerprint} from '../algorithms/editableIdealDna.js';
import {normalizeBodyTypes} from '../model/profile.js';

export const EDITABLE_DNA_STORAGE_KEY = 'carDNA.editableIdealDna.v1';

const storage = () => {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
};

export function saveEditableDna({editable, confirmed = false} = {}) {
  const target = storage();
  if (!target || !editable?.values) return {ok: false, reason: 'storage-unavailable'};
  const record = {
    schemaVersion: EDITABLE_DNA_SCHEMA_VERSION,
    profileFingerprint: editable.profileFingerprint,
    savedAt: new Date().toISOString(),
    confirmed: confirmed === true,
    editable,
  };
  try {
    target.setItem(EDITABLE_DNA_STORAGE_KEY, JSON.stringify(record));
    return {ok: true, record};
  } catch {
    return {ok: false, reason: 'write-failed'};
  }
}

export function loadEditableDna(profile) {
  const target = storage();
  if (!target) return {status: 'unavailable', editable: null, confirmed: false};
  let record;
  try {
    record = JSON.parse(target.getItem(EDITABLE_DNA_STORAGE_KEY) || 'null');
  } catch {
    return {status: 'invalid', editable: null, confirmed: false, reason: 'Stored editable DNA is not valid JSON.'};
  }
  if (!record || typeof record !== 'object' || !record.editable?.values) {
    return {status: 'empty', editable: null, confirmed: false};
  }
  if (record.schemaVersion !== EDITABLE_DNA_SCHEMA_VERSION) {
    return {status: 'stale', editable: null, confirmed: false, reason: 'The stored editable DNA uses an older schema.'};
  }
  const expected = profileFingerprint(profile);
  if (record.profileFingerprint !== expected || record.editable.profileFingerprint !== expected) {
    return {
      status: 'stale',
      editable: null,
      confirmed: false,
      reason: 'The questionnaire profile changed after this DNA was saved, so the old edit was discarded.',
    };
  }
  const profileBodyTypes = normalizeBodyTypes(
    profile && (Array.isArray(profile.acceptableBodyTypes) || typeof profile.acceptableBodyTypes === 'string')
      ? profile.acceptableBodyTypes
      : profile?.preferredBodyType,
  );
  const storedBodyTypes = normalizeBodyTypes(
    record.editable.hard?.allowedBodyTypes?.length
      ? record.editable.hard.allowedBodyTypes
      : profileBodyTypes,
  );
  const finalBodyStyle = record.editable.values.finalBodyStyle || record.editable.values.bodyType;
  const allowedBodyTypes = profileBodyTypes.length ? profileBodyTypes : storedBodyTypes;
  if (!allowedBodyTypes.length || !allowedBodyTypes.includes(finalBodyStyle)) {
    return {
      status: 'stale',
      editable: null,
      confirmed: false,
      reason: 'The saved final body style is no longer one of the questionnaire body styles, so the old edit was discarded.',
    };
  }
  return {
    status: 'ok',
    editable: record.editable,
    confirmed: record.confirmed === true,
    savedAt: record.savedAt || null,
  };
}

export function clearEditableDna() {
  const target = storage();
  if (!target) return;
  try {
    target.removeItem(EDITABLE_DNA_STORAGE_KEY);
  } catch {
    // A blocked storage write must not break the questionnaire.
  }
}
