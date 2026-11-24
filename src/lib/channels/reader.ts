import type { RawPost, TgChannel } from '../types.ts';

export interface ChannelRead {
  /** Título atual do canal (atualiza o cadastro). */
  title?: string;
  /** Mensagens novas, em ordem crescente de id (vazio no primeiro acesso). */
  posts: RawPost[];
  /** Id da mensagem mais recente vista; vira o novo "última lida". */
  latestId: number | null;
  /** Problema ao ler (bloqueio, canal inexistente, FLOOD_WAIT…). */
  error?: string;
}

export interface ChannelReader {
  read(channel: TgChannel): Promise<ChannelRead>;
}

/** Canal/grupo da conta conectada (userbot), para escolher no painel. */
export interface AccountDialog {
  tgId: number;
  accessHash: string | null;
  peerType: 'channel' | 'chat';
  title: string;
  username: string | null;
  /** canal de transmissão ou grupo */
  kind: 'canal' | 'grupo';
}
