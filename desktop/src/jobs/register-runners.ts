import { writeTextFile } from '@tauri-apps/plugin-fs';
import { api } from '../api';
import { readTextAttachmentFromPath } from '../attachments/attachment-service';
import { importContacts, parseCsvContacts, parseVcf, exportContactsToVcf, getContacts } from '../integrations/contacts-service';
import { tasksToIcs, icsToTasks } from '../integrations/calendar-interop';
import { rememberRecentFile } from '../integrations/recent-files-service';
import { knowledgeService } from '../memory/knowledge.service';
import { registerJobRunner } from './job-service';

const TEXT_IMPORT_RE = /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|rs|java|go|html|css|scss|yml|yaml|xml)$/i;

let registered = false;

function basename(path: string) {
  return path.split('/').pop() || path;
}

export function registerDesktopJobRunners() {
  if (registered) return;
  registered = true;

  registerJobRunner('import-kb', async (job, ctx) => {
    const paths = Array.isArray(job.payload.paths) ? job.payload.paths.map(String) : [];
    let imported = 0;
    for (const [index, path] of paths.entries()) {
      ctx.log(`Lecture ${path}`);
      if (!TEXT_IMPORT_RE.test(path)) {
        ctx.log(`Ignoré: format non textuel (${basename(path)})`);
        ctx.setProgress((index + 1) / Math.max(paths.length, 1));
        continue;
      }
      const rawText = await readTextAttachmentFromPath(path);
      await knowledgeService.addDocument({
        title: basename(path),
        rawText,
        source: 'file-import',
        mimeType: 'text/plain',
        tags: ['import'],
      });
      rememberRecentFile({
        name: basename(path),
        mimeType: 'text/plain',
        sizeBytes: new Blob([rawText]).size,
        absolutePath: path,
        note: 'Import KB',
      });
      imported += 1;
      ctx.setProgress((index + 1) / Math.max(paths.length, 1));
    }
    return `${imported} document(s) importé(s)`;
  });

  registerJobRunner('import-contacts', async (job, ctx) => {
    const path = String(job.payload.path || '');
    const rawText = await readTextAttachmentFromPath(path);
    const entries = path.toLowerCase().endsWith('.vcf') ? parseVcf(rawText) : parseCsvContacts(rawText);
    importContacts(entries);
    ctx.log(`${entries.length} contact(s) chargé(s)`);
    rememberRecentFile({
      name: basename(path),
      mimeType: path.toLowerCase().endsWith('.vcf') ? 'text/vcard' : 'text/csv',
      sizeBytes: new Blob([rawText]).size,
      absolutePath: path,
      note: 'Import contacts',
    });
    ctx.setProgress(1);
    return `${entries.length} contact(s) importé(s)`;
  });

  registerJobRunner('export-contacts', async (job, ctx) => {
    const path = String(job.payload.path || '');
    const content = exportContactsToVcf(getContacts());
    await writeTextFile(path, content);
    rememberRecentFile({
      name: basename(path),
      mimeType: 'text/vcard',
      sizeBytes: new Blob([content]).size,
      absolutePath: path,
      note: 'Export contacts',
    });
    ctx.log(`Fichier écrit ${path}`);
    ctx.setProgress(1);
    return 'Contacts exportés';
  });

  registerJobRunner('import-calendar', async (job, ctx) => {
    const path = String(job.payload.path || '');
    const rawText = await readTextAttachmentFromPath(path);
    const tasks = icsToTasks(rawText);
    for (const [index, task] of tasks.entries()) {
      await api.createTask(task);
      ctx.log(`Tâche importée: ${task.title}`);
      ctx.setProgress((index + 1) / Math.max(tasks.length, 1));
    }
    rememberRecentFile({
      name: basename(path),
      mimeType: 'text/calendar',
      sizeBytes: new Blob([rawText]).size,
      absolutePath: path,
      note: 'Import calendrier',
    });
    return `${tasks.length} tâche(s) importée(s)`;
  });

  registerJobRunner('export-calendar', async (job, ctx) => {
    const path = String(job.payload.path || '');
    const tasks = await api.getTasks();
    const content = tasksToIcs(tasks);
    await writeTextFile(path, content);
    rememberRecentFile({
      name: basename(path),
      mimeType: 'text/calendar',
      sizeBytes: new Blob([content]).size,
      absolutePath: path,
      note: 'Export calendrier',
    });
    ctx.log(`Calendrier exporté ${path}`);
    ctx.setProgress(1);
    return `${tasks.length} tâche(s) exportée(s)`;
  });
}
