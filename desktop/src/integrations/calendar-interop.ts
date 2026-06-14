import type { TaskInput, TaskItem } from '../types';

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function formatDate(date: Date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function formatDateTime(date: Date) {
  return `${formatDate(date)}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function parseFloatingDate(value: string) {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  }
  if (/^\d{8}T\d{6}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}`;
  }
  return value;
}

export function tasksToIcs(tasks: TaskItem[]) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Progsoft//Monkey//FR',
    ...tasks.flatMap(task => {
      const start = new Date(task.scheduledFor);
      const end = task.endsAt ? new Date(task.endsAt) : null;
      const body = [
        'BEGIN:VEVENT',
        `UID:${task.id}@monkey.local`,
        `SUMMARY:${task.title.replace(/\n/g, ' ')}`,
        task.details ? `DESCRIPTION:${task.details.replace(/\n/g, '\\n')}` : '',
        task.allDay
          ? `DTSTART;VALUE=DATE:${formatDate(start)}`
          : `DTSTART:${formatDateTime(start)}`,
        end
          ? (task.allDay ? `DTEND;VALUE=DATE:${formatDate(end)}` : `DTEND:${formatDateTime(end)}`)
          : '',
        task.recurrence ? `RRULE:${task.recurrence}` : '',
        'END:VEVENT',
      ].filter(Boolean);
      return body;
    }),
    'END:VCALENDAR',
  ];
  return `${lines.join('\n')}\n`;
}

export function icsToTasks(text: string): TaskInput[] {
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1);
  const tasks: TaskInput[] = [];
  for (const block of blocks) {
    const summaryMatch = block.match(/\nSUMMARY:(.+)/);
    const descMatch = block.match(/\nDESCRIPTION:(.+)/);
    const startMatch = block.match(/\nDTSTART(?:;VALUE=DATE)?:([^\n]+)/);
    const endMatch = block.match(/\nDTEND(?:;VALUE=DATE)?:([^\n]+)/);
    const rruleMatch = block.match(/\nRRULE:([^\n]+)/);
    if (!summaryMatch || !startMatch) continue;
    const startValue = startMatch[1].trim();
    const allDay = /^\d{8}$/.test(startValue);
    tasks.push({
      title: summaryMatch[1].trim(),
      details: (descMatch?.[1] || '').replace(/\\n/g, '\n'),
      scheduledFor: parseFloatingDate(startValue),
      endsAt: endMatch ? parseFloatingDate(endMatch[1].trim()) : null,
      allDay,
      status: 'planned',
      source: 'calendar-import',
      recurrence: rruleMatch ? rruleMatch[1].trim() : null,
    });
  }
  return tasks;
}
