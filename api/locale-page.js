import fs from 'node:fs';
import { localizeHtmlHead } from '../src/i18n/html-head.js';

export default function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).end();
  }
  const url = new URL(request.url, 'https://www.btcaipro.com');
  const locale = url.searchParams.get('locale');
  const page = url.searchParams.get('page') === 'sources' ? 'sources' : 'dashboard';
  if (!['zh', 'en'].includes(locale)) return response.status(400).end();
  const shell = page === 'sources'
    ? fs.readFileSync(new URL('../sources.html', import.meta.url), 'utf8')
    : fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const html = localizeHtmlHead(shell, { locale, page });
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  return response.status(200).send(request.method === 'HEAD' ? '' : html);
}
