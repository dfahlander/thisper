import { DI } from "../src/thisper";

test ("Abstract class", ()=>{

  abstract class Storage {
    abstract load(key: string): string;
    abstract save(key: string, value: string): void;
  }

  class DummyStorage extends Storage {
    load(key: string) {
      return key;
    }
    save(key: string, value: string) {

    }
  }
    
  DI(DummyStorage).run(function(){
    const value = this(Storage).load("foo abc");
    expect(value).toBe("foo abc");
  });
  
});
