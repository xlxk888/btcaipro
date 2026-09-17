import net from 'node:net';
import tls from 'node:tls';

const encode = parts => Buffer.from(`*${parts.length}\r\n${parts.map(value => `$${Buffer.byteLength(String(value))}\r\n${value}\r\n`).join('')}`);

function parseReply(buffer, offset = 0) {
  const lineEnd = buffer.indexOf('\r\n', offset);
  if (lineEnd < 0) return null;
  const marker = String.fromCharCode(buffer[offset]);
  const header = buffer.toString('utf8', offset + 1, lineEnd);
  if (marker === '+' || marker === ':' || marker === '-') {
    if (marker === '-') throw new Error(header);
    return { value: marker === ':' ? Number(header) : header, offset: lineEnd + 2 };
  }
  if (marker === '$') {
    const length = Number(header);
    if (length < 0) return { value: null, offset: lineEnd + 2 };
    const end = lineEnd + 2 + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.toString('utf8', lineEnd + 2, end), offset: end + 2 };
  }
  if (marker === '*') {
    const values = []; let cursor = lineEnd + 2;
    for (let index = 0; index < Number(header); index += 1) {
      const item = parseReply(buffer, cursor);
      if (!item) return null;
      values.push(item.value); cursor = item.offset;
    }
    return { value: values, offset: cursor };
  }
  throw new Error('Unsupported Redis response');
}

export class RedisCache {
  constructor(url, { timeoutMs = 1_500 } = {}) {
    this.url = new URL(url);
    this.timeoutMs = timeoutMs;
  }

  async command(parts) {
    const socketFactory = this.url.protocol === 'rediss:' ? tls.connect : net.createConnection;
    const port = Number(this.url.port || (this.url.protocol === 'rediss:' ? 6380 : 6379));
    const commands = [];
    if (this.url.password) commands.push(this.url.username ? ['AUTH', decodeURIComponent(this.url.username), decodeURIComponent(this.url.password)] : ['AUTH', decodeURIComponent(this.url.password)]);
    const database = Number(this.url.pathname.slice(1) || 0);
    if (database) commands.push(['SELECT', database]);
    commands.push(parts);
    return new Promise((resolve, reject) => {
      const socket = socketFactory({ host: this.url.hostname, port, servername: this.url.hostname });
      let buffer = Buffer.alloc(0); const replies = [];
      const timer = setTimeout(() => socket.destroy(new Error('Redis timeout')), this.timeoutMs);
      socket.on('connect', () => commands.forEach(command => socket.write(encode(command))));
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          let parsed;
          while ((parsed = parseReply(buffer))) {
            replies.push(parsed.value); buffer = buffer.subarray(parsed.offset);
            if (replies.length === commands.length) { clearTimeout(timer); socket.end(); resolve(replies.at(-1)); return; }
          }
        } catch (error) { clearTimeout(timer); socket.destroy(); reject(error); }
      });
      socket.on('error', reject);
      socket.on('close', () => { clearTimeout(timer); if (replies.length < commands.length) reject(new Error('Redis connection closed before reply')); });
    });
  }

  async get(key) { return this.command(['GET', key]); }
  async set(key, value, ttlMs = 0) {
    const args = ['SET', key, value];
    if (ttlMs > 0) args.push('PX', Math.round(ttlMs));
    return (await this.command(args)) === 'OK';
  }
  async setIfAbsent(key, value, ttlMs = 0) {
    const args = ['SET', key, value, 'NX'];
    if (ttlMs > 0) args.push('PX', Math.round(ttlMs));
    return (await this.command(args)) === 'OK';
  }
  async delete(key) { return Number(await this.command(['DEL', key])) > 0; }
  async ping() { return (await this.command(['PING'])) === 'PONG'; }
  status() { return { backend: 'redis', state: 'configured', host: this.url.hostname }; }
}
