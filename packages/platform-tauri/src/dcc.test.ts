import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
const listen = vi.fn<(event: string, handler: unknown) => Promise<() => void>>();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: unknown) => listen(event, handler),
}));

const { createDcc } = await import('./dcc.js');

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset();
  listen.mockResolvedValue(() => {});
});

/**
 * The two shells differ only around the download itself, and each difference is
 * a platform saying it cannot do something rather than a caller forgetting to
 * pass it. What matters is that the absences reach the interface as absences:
 * the settings screen and the file list hide what the shell did not pass, so a
 * capability that lied about having a picker would draw a button that opens
 * nothing.
 */
describe('the file monitor a shell asks for', () => {
  it('has a picker and a reveal on a desktop', () => {
    const dcc = createDcc({
      chooseFolder: async () => '/home/marmot/Downloads',
      revealFiles: true,
    });

    expect(dcc.chooseDownloadFolder).toBeTypeOf('function');
    expect(dcc.revealFile).toBeTypeOf('function');
  });

  it('has neither on Android, where the platform has neither', () => {
    const dcc = createDcc();

    expect(dcc.chooseDownloadFolder).toBeUndefined();
    expect(dcc.revealFile).toBeUndefined();
    // What it has instead: the shell names the one folder it may write to.
    expect(dcc.defaultDownloadFolder).toBeTypeOf('function');
  });

  it('asks the shell where it may write', async () => {
    invoke.mockResolvedValue('/data/user/0/uk.co.dashkova.marmotter/files/downloads');
    const dcc = createDcc();

    await expect(dcc.defaultDownloadFolder?.()).resolves.toContain('downloads');
    expect(invoke).toHaveBeenCalledWith('dcc_default_dir', undefined);
  });

  it('tags each transfer so two at once do not drive each other’s progress', async () => {
    invoke.mockResolvedValue('/downloads/marmot.png');
    const dcc = createDcc();

    const first = dcc.download({ host: '10.0.0.1', port: 5000, filename: 'a.png', folder: '/d' });
    const second = dcc.download({ host: '10.0.0.1', port: 5001, filename: 'b.png', folder: '/d' });
    await Promise.all([first.done, second.done]);

    const ids = invoke.mock.calls
      .filter(([command]) => command === 'dcc_download_file')
      .map(([, args]) => (args as { request: { transferId: string } }).request.transferId);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('stops a transfer by the id it was started under', async () => {
    invoke.mockResolvedValue('/downloads/marmot.png');
    const dcc = createDcc();

    const transfer = dcc.download({
      host: '10.0.0.1',
      port: 5000,
      filename: 'a.png',
      folder: '/d',
    });
    await transfer.done;
    transfer.cancel();

    const started = invoke.mock.calls.find(([command]) => command === 'dcc_download_file');
    const stopped = invoke.mock.calls.find(([command]) => command === 'dcc_cancel_download');
    expect((stopped?.[1] as { transferId: string }).transferId).toBe(
      (started?.[1] as { request: { transferId: string } }).request.transferId,
    );
  });
});

describe('a reverse transfer', () => {
  it('reports the bound port before the command resolves, so the reply can go out', async () => {
    // The socket is bound early inside the command and the port arrives as an
    // event. A subscription made after the invoke would miss it, and nothing
    // would ever connect — so the shell announces mid-invoke here, exactly as
    // the real one does.
    let announce: ((event: { payload: unknown }) => void) | undefined;
    listen.mockImplementation((event, handler) => {
      if (event === 'marmotter://dcc-listening') {
        announce = handler as (event: { payload: unknown }) => void;
      }
      return Promise.resolve(() => {});
    });
    invoke.mockImplementation((command, args) => {
      if (command !== 'dcc_receive_passive') {
        return Promise.resolve(undefined);
      }
      const { request } = args as { request: { transferId: string } };
      announce?.({
        payload: { id: request.transferId, port: 44_444, address: '203.0.113.5' },
      });
      return Promise.resolve('/tmp/dl/file.bin');
    });

    const listening: { address: string | undefined; port: number }[] = [];
    const transfer = createDcc().receivePassive?.(
      { host: '198.51.100.9', filename: 'file.bin', folder: '/tmp/dl', size: 10 },
      (address, port) => listening.push({ address, port }),
    );

    expect(await transfer?.done).toBe('/tmp/dl/file.bin');
    expect(listening).toEqual([{ address: '203.0.113.5', port: 44_444 }]);
    expect(
      invoke.mock.calls.find(([command]) => command === 'dcc_receive_passive')?.[1],
    ).toMatchObject({ request: { host: '198.51.100.9', folder: '/tmp/dl', size: 10 } });
  });

  it('is offered by every Tauri shell, since both can listen', () => {
    expect(createDcc().receivePassive).toBeTypeOf('function');
  });
});

describe('continuing a file', () => {
  it('asks the shell what an earlier attempt already wrote', async () => {
    invoke.mockResolvedValue(4096);
    await expect(createDcc().resumableBytes?.('/tmp/dl', 'big.bin')).resolves.toBe(4096);
    expect(invoke).toHaveBeenCalledWith('dcc_resumable_bytes', {
      folder: '/tmp/dl',
      filename: 'big.bin',
    });
  });

  it('passes the agreed position down to the transfer', async () => {
    invoke.mockResolvedValue('/tmp/dl/big.bin');
    await createDcc().download({
      host: '1.2.3.4',
      port: 5000,
      filename: 'big.bin',
      folder: '/tmp/dl',
      resumeFrom: 4096,
    }).done;
    expect(invoke).toHaveBeenCalledWith(
      'dcc_download_file',
      expect.objectContaining({ request: expect.objectContaining({ resumeFrom: 4096 }) }),
    );
  });

  it('sends null rather than nothing when there is no position, so the shell reads it', async () => {
    invoke.mockResolvedValue('/tmp/dl/big.bin');
    await createDcc().download({ host: '1.2.3.4', port: 5000, filename: 'b', folder: '/tmp' }).done;
    expect(invoke).toHaveBeenCalledWith(
      'dcc_download_file',
      expect.objectContaining({ request: expect.objectContaining({ resumeFrom: null }) }),
    );
  });
});
