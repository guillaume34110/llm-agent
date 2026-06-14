import { createLocalStore } from '../lib/local-store';

export interface ContactEntry {
  id: string;
  fullName: string;
  emails: string[];
  phones: string[];
  notes: string;
  source: 'manual' | 'vcf' | 'csv';
  createdAt: string;
  updatedAt: string;
}

const store = createLocalStore<ContactEntry[]>('monkey-contacts', []);

function now() {
  return new Date().toISOString();
}

export function getContacts() {
  return store.read().sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export function subscribeContacts(listener: (contacts: ContactEntry[]) => void) {
  return store.subscribe(() => listener(getContacts()));
}

export function saveContact(input: Omit<ContactEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const contact: ContactEntry = {
    id: input.id || crypto.randomUUID(),
    fullName: input.fullName.trim(),
    emails: input.emails.filter(Boolean),
    phones: input.phones.filter(Boolean),
    notes: input.notes.trim(),
    source: input.source,
    createdAt: input.id ? (getContacts().find(item => item.id === input.id)?.createdAt || now()) : now(),
    updatedAt: now(),
  };
  store.update(prev => {
    const without = prev.filter(item => item.id !== contact.id);
    return [...without, contact];
  });
  return contact;
}

export function deleteContact(contactId: string) {
  store.write(store.read().filter(contact => contact.id !== contactId));
}

function splitValues(value: string) {
  return value.split(/[;,]/).map(item => item.trim()).filter(Boolean);
}

export function parseVcf(text: string) {
  const cards = text.split(/END:VCARD/i).map(block => block.trim()).filter(Boolean);
  const contacts: ContactEntry[] = [];
  for (const card of cards) {
    const lines = card.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    let fullName = '';
    const emails: string[] = [];
    const phones: string[] = [];
    const notes: string[] = [];
    for (const line of lines) {
      if (line.startsWith('FN:')) fullName = line.slice(3).trim();
      if (line.startsWith('EMAIL')) {
        const [, value = ''] = line.split(':');
        emails.push(...splitValues(value));
      }
      if (line.startsWith('TEL')) {
        const [, value = ''] = line.split(':');
        phones.push(...splitValues(value));
      }
      if (line.startsWith('NOTE:')) notes.push(line.slice(5).trim());
    }
    if (!fullName && !emails.length && !phones.length) continue;
    contacts.push({
      id: crypto.randomUUID(),
      fullName: fullName || emails[0] || phones[0] || 'Contact',
      emails,
      phones,
      notes: notes.join('\n'),
      source: 'vcf',
      createdAt: now(),
      updatedAt: now(),
    });
  }
  return contacts;
}

export function parseCsvContacts(text: string) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const separator = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(separator).map(header => header.trim().toLowerCase());
  const nameIndex = headers.findIndex(header => ['name', 'full_name', 'fullname', 'nom'].includes(header));
  const emailIndex = headers.findIndex(header => ['email', 'mail'].includes(header));
  const phoneIndex = headers.findIndex(header => ['phone', 'tel', 'telephone', 'mobile'].includes(header));
  const notesIndex = headers.findIndex(header => ['notes', 'note'].includes(header));
  return lines.slice(1).map(line => {
    const cols = line.split(separator).map(col => col.trim());
    return {
      id: crypto.randomUUID(),
      fullName: cols[nameIndex] || cols[emailIndex] || cols[phoneIndex] || 'Contact',
      emails: cols[emailIndex] ? splitValues(cols[emailIndex]) : [],
      phones: cols[phoneIndex] ? splitValues(cols[phoneIndex]) : [],
      notes: cols[notesIndex] || '',
      source: 'csv' as const,
      createdAt: now(),
      updatedAt: now(),
    };
  }).filter(contact => contact.fullName || contact.emails.length || contact.phones.length);
}

export function importContacts(entries: ContactEntry[]) {
  store.update(prev => {
    const byKey = new Map<string, ContactEntry>();
    for (const contact of prev) {
      const key = `${contact.fullName.toLowerCase()}|${contact.emails.join(',').toLowerCase()}|${contact.phones.join(',')}`;
      byKey.set(key, contact);
    }
    for (const contact of entries) {
      const key = `${contact.fullName.toLowerCase()}|${contact.emails.join(',').toLowerCase()}|${contact.phones.join(',')}`;
      byKey.set(key, contact);
    }
    return [...byKey.values()];
  });
}

export function exportContactsToVcf(contacts: ContactEntry[]) {
  return contacts.map(contact => [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${contact.fullName}`,
    ...contact.emails.map(email => `EMAIL:${email}`),
    ...contact.phones.map(phone => `TEL:${phone}`),
    ...(contact.notes ? [`NOTE:${contact.notes.replace(/\n/g, '\\n')}`] : []),
    'END:VCARD',
  ].join('\n')).join('\n');
}
