import { DI, Service } from "../src/thisper";


class Svc extends Service {
  foo(names: string[]) {
    return names.map(name => this.new(Item, name).withExclamations);
  }
}

class Item extends Service({stateful: true}) {
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
  exclaim() { return "!"; }
}

class QuestionMark extends Exclamation {
  exclaim(): string {
    return "?"
  }
}


test ("try creating contextual class via new", ()=>{
  //expect(()=>new Service().foo()).toThrow();
  DI(QuestionMark).run(function(){
    const result = this(Svc).foo(["David", "Ylva"]);
    expect(result).toEqual(["David?", "Ylva?"]);
    this(DI).DI(Exclamation).run(function(){
      const result = this(Svc).foo(["David", "Ylva"]);
      expect(result).toEqual(["David!", "Ylva!"]);
    });
  });
  
});
