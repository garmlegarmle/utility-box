import { marked } from 'marked';

export function renderSectionMarkdown(body: string): string {
  const html = marked.parse(body ?? '', { async: false }) as string;
  return html.replace(/<h1(\b[^>]*)>/gi, '<h2$1>').replace(/<\/h1>/gi, '</h2>');
}
