import { buildCells, hostOf, ProviderAction, linesModel } from '../../src/ui/pages/providersPage.js';

const providers = [
  { id: 'a', name: 'A', baseUrl: 'http://one.example:8080', username: 'u' },
  { id: 'b', name: 'B', baseUrl: 'https://two.example/path', username: 'v' },
];

describe('providers list', () => {
  test('per provider its toggle and four actions; under an active one its table buttons; then "add"', () => {
    const cells = buildCells(providers, ['b']);
    expect(cells.map((c) => c.action)).toEqual([
      ProviderAction.USE, ProviderAction.CATEGORIES, ProviderAction.EDIT, ProviderAction.REMOVE, ProviderAction.FORMAT,
      ProviderAction.USE, ProviderAction.CATEGORIES, ProviderAction.EDIT, ProviderAction.REMOVE, ProviderAction.FORMAT,
      ProviderAction.REFRESH_LISTS, ProviderAction.REMOVE_LISTS,
      ProviderAction.ADD,
    ]);
    expect(cells.map((c) => c.line)).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 3]);
  });

  test('the toggle says whether the provider is active; several can be', () => {
    const cells = buildCells(providers, ['a', 'b']);
    expect(cells.filter((c) => c.action === ProviderAction.USE).map((c) => c.on)).toEqual([true, true]);
    expect(cells.filter((c) => c.action === ProviderAction.REFRESH_LISTS)).toHaveLength(2);
    expect(buildCells(providers, 'a').filter((c) => c.action === ProviderAction.USE).map((c) => c.on)).toEqual([true, false]);
  });

  test('with no provider only "add" remains', () => {
    expect(buildCells([], null)).toEqual([{ action: ProviderAction.ADD, line: 0, col: 0 }]);
  });

  test('line navigation: Up / Down to the nearest column, Left / Right along a line', () => {
    const cells = buildCells(providers, ['b']);
    const model = linesModel(() => cells);
    expect(model.navigate('down', 2)).toEqual({ type: 'move', index: 7 }); // edit A → edit B
    expect(model.navigate('down', 9)).toEqual({ type: 'move', index: 11 }); // format → table remove
    expect(model.navigate('right', 10)).toEqual({ type: 'move', index: 11 });
    expect(model.navigate('right', 11)).toEqual({ type: 'exit', dir: 'right' });
    expect(model.navigate('down', 11)).toEqual({ type: 'move', index: 12 });
    expect(model.navigate('up', 12)).toEqual({ type: 'move', index: 10 });
  });

  test('hostOf hides scheme, path and credentials', () => {
    expect(hostOf('http://one.example:8080')).toBe('one.example:8080');
    expect(hostOf('https://two.example/path')).toBe('two.example');
  });
});

test('playlist providers have no Xtream format setting', () => {
  expect(buildCells([{ ...providers[0], type: 'm3u' }], []).some((c) => c.action === ProviderAction.FORMAT)).toBe(false);
});

test('remote format choice is saved without an account request; cancelling preserves it', async () => {
  const { createProvidersPage } = require('../../src/ui/pages/providersPage.js');
  const { FocusManager } = require('../../src/ui/focus/FocusManager.js');
  const { Action } = require('../../src/core/input.js');
  const provider = { ...providers[0] };
  const ctx = {
    focus: new FocusManager(),
    providers: {
      list: async () => [provider], listActive: async () => [],
      update: jest.fn(async (id, patch) => Object.assign(provider, patch)),
    },
    dialogs: { choose: jest.fn().mockResolvedValueOnce('ts').mockResolvedValueOnce(null) },
    notices: { success: jest.fn() },
  };
  const page = createProvidersPage(ctx);
  document.body.appendChild(page.el);
  page.mount();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await flush();
    ctx.focus.focus('providers', 4);
    ctx.focus.handle(Action.ENTER);
    await flush();
    expect(ctx.providers.update).toHaveBeenCalledWith('a', { liveFormat: 'ts' });
    expect(page.el.textContent).toContain('Live TV format: MPEG-TS');
    ctx.focus.handle(Action.ENTER);
    await flush();
    expect(ctx.dialogs.choose).toHaveBeenLastCalledWith(expect.objectContaining({ selected: 'ts' }));
    expect(ctx.providers.update).toHaveBeenCalledTimes(1);
  } finally { page.destroy(); page.el.remove(); }
});
