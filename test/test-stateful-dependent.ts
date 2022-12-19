import { DIContext, DI, Service } from '../src/thisper';

abstract class Storage {}
interface Storage {
  getItem(key: string): string | undefined | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Friend {
  name: string;
  age: number;
}

class Logger {
  private console?: Console;
  constructor(console?: Console) {
    this.console = console;
  }
  log(msg: string) {
    this.console?.log(msg);
  }
}

class FriendStorage extends Service({ stateful: true, deps: [Storage] }) {
  private cache = new Map<string, Friend>();

  listFriendNames() {
    debugger;
    return this(Storage).getItem('*')?.split(',') ?? [];
  }

  loadFriend(name: string) {
    if (this.cache.get(name)) return this.cache.get(name);
    const json = this(Storage).getItem(name);
    if (!json) return null;
    const result = JSON.parse(json) as Friend;
    this.cache.set(name, result);
    return result;
  }

  saveFriend(friend: Friend) {
    this(Logger).log('Saving friend');
    const allFriends = new Set(this.listFriendNames());
    allFriends.add(friend.name);
    const storage = this(Storage);
    storage.setItem('*', [...allFriends].join(','));
    storage.setItem(friend.name, JSON.stringify(friend));
    this.cache.delete(friend.name);
  }
}

class FriendService extends Service {
  listFriends(): Friend[] {
    const friendStorage = this(FriendStorage);
    const friendNames = friendStorage.listFriendNames();
    return friendNames
      .map((friendName) => friendStorage.loadFriend(friendName)!)
      .filter((f) => f);
  }

  addFriend(friend: Friend) {
    this(FriendStorage).saveFriend(friend);
  }

  updateFriend(friend: Friend) {
    if (this(FriendStorage).loadFriend(friend.name)) {
      this(FriendStorage).saveFriend(friend);
    }
  }

  removeFriend(friendName: string) {
    this(Storage).removeItem(friendName);
    this(Storage).setItem(
      '*',
      this(FriendStorage)
        .listFriendNames()
        .filter((n) => n !== friendName)
        .join(',')
    );
  }
}

class MemStorage extends Storage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

test('Stateful dependence', () => {
  const ctx = DI(new MemStorage(), new Logger());
  ctx.run(function () {
    debugger;
    this(FriendService).addFriend({ name: 'foo', age: 1 });
    debugger;
    this(FriendService).addFriend({ name: 'bar', age: 2 });

    expect(this(FriendService).listFriends()).toEqual([
      {
        name: 'foo',
        age: 1,
      },
      {
        name: 'bar',
        age: 2,
      },
    ]);

    this(Storage).removeItem('foo');
    // Manipulating underlying storage will still give same result
    // because FriendStorage has a cache:
    expect(this(FriendService).listFriends()).toEqual([
      {
        name: 'foo',
        age: 1,
      },
      {
        name: 'bar',
        age: 2,
      },
    ]);

    const newLogger = new Logger();
    this(DIContext)
      .provide(newLogger)
      .run(function () {
        // Expect same values because Logger is not among deps:
        expect(this(FriendService).listFriends()).toEqual([
          {
            name: 'foo',
            age: 1,
          },
          {
            name: 'bar',
            age: 2,
          },
        ]);
      });

    const newMemStorage = new MemStorage();
    this(DIContext)
      .provide(newMemStorage)
      .run(function () {
        // Expect empty because Storage is among deps:
        expect(this(FriendService).listFriends()).toEqual([]);
      });
  });
});
