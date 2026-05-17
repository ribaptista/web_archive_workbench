import { REPLAY_SERVER_URL } from './config';

export function replayUrl(timestamp: number, url: string): string {
  return `${REPLAY_SERVER_URL}/replay/${timestamp}/${url}`;
}
