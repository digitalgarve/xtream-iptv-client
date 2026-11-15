import { buildCells, hostOf, ProviderAction, linesModel } from '../../src/ui/pages/providersPage.js';

const providers = [
  { id: 'a', name: 'A', baseUrl: 'http://one.example:8080', username: 'u' },
  { id: 'b', name: 'B', baseUrl: 'https://two.example/path', username: 'v' },
];

describe('providers list', () => {
  test('per provider its toggle and three actions; under an active one its table buttons; then "add"', () => {
    const cells = buildCells(providers, ['b']);
    expect(cells.map((c) => c.action)).toEqual([
      ProviderAction.USE, ProviderAction.CATEGORIES, ProviderAction.EDIT, ProviderAction.REMOVE,
      ProviderAction.USE, ProviderAction.CATEGORIES, ProviderAction.EDIT, ProviderAction.REMOVE,
      ProviderAction.REFRESH_LISTS, ProviderAction.REMOVE_LISTS,
      ProviderAction.ADD,
    ]);
    expect(cells.map((c) => c.line)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3]);
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
    expect(model.navigate('down', 2)).toEqual({ type: 'move', index: 6 }); // edit of A → edit of B
    expect(model.navigate('down', 7)).toEqual({ type: 'move', index: 9 }); // remove of B → the table's remove
    expect(model.navigate('right', 8)).toEqual({ type: 'move', index: 9 });
    expect(model.navigate('right', 9)).toEqual({ type: 'exit', dir: 'right' });
    expect(model.navigate('down', 9)).toEqual({ type: 'move', index: 10 }); // add
    expect(model.navigate('up', 10)).toEqual({ type: 'move', index: 8 });
  });

  test('hostOf hides scheme, path and credentials', () => {
    expect(hostOf('http://one.example:8080')).toBe('one.example:8080');
    expect(hostOf('https://two.example/path')).toBe('two.example');
  });
});
