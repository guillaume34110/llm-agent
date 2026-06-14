export interface RecurrencePreset { value: string; label: string }

export const RECURRENCE_PRESETS: RecurrencePreset[] = [
  { value: '', label: 'One-shot' },
  { value: 'FREQ=MINUTELY;INTERVAL=10', label: '10 min' },
  { value: 'FREQ=MINUTELY;INTERVAL=30', label: '30 min' },
  { value: 'FREQ=HOURLY', label: '1 h' },
  { value: 'FREQ=HOURLY;INTERVAL=2', label: '2 h' },
  { value: 'FREQ=DAILY', label: 'Jour' },
  { value: 'FREQ=WEEKLY', label: 'Semaine' },
  { value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', label: 'Ouvré' },
  { value: 'FREQ=MONTHLY;BYDAY=1MO', label: '1er lun' },
  { value: 'FREQ=MONTHLY', label: 'Mois' },
  { value: 'custom', label: 'Custom RRULE' },
];

export function matchRecurrencePreset(rule: string | null | undefined): string {
  const r = (rule || '').trim();
  if (!r) return '';
  const hit = RECURRENCE_PRESETS.find(p => p.value === r);
  return hit ? hit.value : 'custom';
}

export function formatOccurrence(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  } catch { return iso; }
}
