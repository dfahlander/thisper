import { DI } from '../src/thisper';

abstract class Storage {
  abstract load(key: string): string;
  abstract save(key: string, value: string): void;
}

class DummyStorage extends Storage {
  load(key: string) {
    return key;
  }
  save(key: string, value: string) {}
}

test('Simple injection', () => {
  const result = DI().inject(DummyStorage).load('key123');
  expect(result).toBe('key123');
});

test('Fail inject non-mapped abstract class', () => {
  const ctx = DI();
  expect(() => ctx.inject(Storage).load('key123')).toThrow();
});

test('Simple inject mapped abstract class', () => {
  const ctx = DI(DummyStorage);
  expect(ctx.inject(Storage).load('key123')).toBe('key123');
});

test('DI.run()', () => {
  const ctx = DI(DummyStorage);
  const value = ctx.run(function () {
    return this(Storage).load('foo abc');
  });
  expect(value).toBe('foo abc');
});
