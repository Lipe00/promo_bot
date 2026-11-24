import * as cheerio from 'cheerio';
import type { AdapterEnv, RawPost, TgChannel } from '../types.ts';
import type { ChannelRead, ChannelReader } from './reader.ts';

/**
 * Canais públicos pela página aberta do Telegram: https://t.me/s/<canal> (últimas ~20 mensagens,
 * `?before=<id>` para as anteriores). Não precisa de login. t.me/robots.txt responde 404 (nada proibido).
 * TELEGRAM_PREVIEW_BASE existe só para os testes locais (servidor falso).
 */

function base(): string {
  return (process.env.TELEGRAM_PREVIEW_BASE || 'https://t.me').replace(/\/+$/, '');
}

/** "@nome", "t.me/nome", "https://t.me/s/nome" ou "nome" → "nome". */
export function normalizeChannelUsername(input: string): string | null {
  const s = input.trim().replace(/^@/, '').replace(/^https?:\/\//i, '').replace(/^(www\.)?(t|telegram)\.me\//i, '').replace(/^s\//, '');
  const name = s.split(/[/?#]/)[0] ?? '';
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name) ? name : null;
}

export interface PreviewPage {
  title: string;
  /** Nome canônico (o canal pode ter mudado de @). */
  username: string | null;
  posts: RawPost[];
}

export function parsePreviewPage(html: string): PreviewPage {
  const $ = cheerio.load(html);
  const title = $('.tgme_channel_info_header_title').first().text().trim();
  let username: string | null = null;
  const posts: RawPost[] = [];
  $('.tgme_widget_message[data-post]').each((_i, el) => {
    const msg = $(el);
    const dataPost = msg.attr('data-post') ?? '';
    const [chan, idText] = dataPost.split('/');
    const messageId = Number(idText);
    if (!chan || !Number.isSafeInteger(messageId)) return;
    username = chan;
    const textEl = msg.find('.tgme_widget_message_text').first().clone();
    textEl.find('br').replaceWith('\n');
    const text = textEl.text().replace(/ /g, ' ').trim();
    const links = new Set<string>();
    textEl.find('a[href]').each((_j, a) => {
      const href = $(a).attr('href') ?? '';
      if (/^https?:\/\//i.test(href) && !/[?&]q=%23/.test(href)) links.add(href);
    });
    msg.find('a.tgme_widget_message_link_preview[href]').each((_j, a) => {
      links.add($(a).attr('href') ?? '');
    });
    const postedAt = msg.find('.tgme_widget_message_date time[datetime], time[datetime]').first().attr('datetime');
    if (!postedAt) return;
    posts.push({
      messageId,
      postedAt: new Date(postedAt).toISOString(),
      text,
      links: [...links].filter(Boolean),
      postUrl: `https://t.me/${chan}/${messageId}`,
    });
  });
  posts.sort((a, b) => a.messageId - b.messageId);
  return { title, username, posts };
}

/** Lê as mensagens novas (id > última lida). No primeiro acesso, só devolve o id mais recente. */
export function makePreviewReader(env: AdapterEnv, opts: { maxPages?: number } = {}): ChannelReader {
  const maxPages = opts.maxPages ?? 3;
  return {
    async read(channel: TgChannel): Promise<ChannelRead> {
      const name = channel.username;
      if (!name) return { error: 'canal sem @ (privado): precisa da conta do Telegram conectada', posts: [], latestId: null };
      const lastId = channel.last_message_id;
      const all = new Map<number, RawPost>();
      let title = '';
      let before: number | null = null;
      for (let page = 0; page < maxPages; page++) {
        const url = `${base()}/s/${encodeURIComponent(name)}${before ? `?before=${before}` : ''}`;
        const out = await env.fetchHtml(url);
        if (out.kind !== 'ok') return { error: out.message, posts: [], latestId: null };
        const parsed = parsePreviewPage(out.html);
        if (page === 0) {
          title = parsed.title;
          if (parsed.posts.length === 0) {
            return { error: 'canal não encontrado ou sem prévia pública (privado?)', posts: [], latestId: null };
          }
        }
        for (const p of parsed.posts) all.set(p.messageId, p);
        const minId = Math.min(...parsed.posts.map((p) => p.messageId));
        // Primeiro acesso, ou já cobrimos tudo desde a última lida: para.
        if (lastId === null || parsed.posts.length === 0 || minId <= lastId + 1) break;
        before = minId;
      }
      const sorted = [...all.values()].sort((a, b) => a.messageId - b.messageId);
      const latestId = sorted.at(-1)?.messageId ?? null;
      return {
        title,
        posts: lastId === null ? [] : sorted.filter((p) => p.messageId > lastId),
        latestId,
      };
    },
  };
}
