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
