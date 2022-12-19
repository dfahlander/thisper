import { DI, DIContext, Service } from '../src/thisper';

class Svc extends Service {
  foo(names: string[]) {
    return names.map((name) => this.new(Item, name).withExclamations);
  }
}

class Item extends Service({ stateful: true }) {
  name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }

  get withExclamations() {
    return this.name + this(Exclamation).exclaim();
  }
}

class Exclamation {
  exclaim() {
    return '!';
  }
}

class QuestionMark extends Exclamation {
  exclaim(): string {
    return '?';
  }
}

test('Throw when constructing service via new', () => {
  // @ts-ignore
  expect(() => new Svc().foo()).toThrow();
});

test('try creating service via new', () => {
  DI(QuestionMark).run(function () {
    const result = this(Svc).foo(['David', 'Ylva']);
    expect(result).toEqual(['David?', 'Ylva?']);
    this(DIContext)
      .provide(Exclamation)
      .run(function () {
        const result = this(Svc).foo(['David', 'Ylva']);
        expect(result).toEqual(['David!', 'Ylva!']);
      });
    {
      let result = this(DIContext)
        .provide(Exclamation)
        .inject(Svc)
        .foo(['Hej']);
      expect(result).toEqual(['Hej!']);
      result = this(DIContext).provide(QuestionMark).inject(Svc).foo(['Hej']);
      expect(result).toEqual(['Hej?']);
    }
  });
});
