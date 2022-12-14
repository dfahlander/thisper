type Class<T = any> = new (...args: any[]) => T;
type AbstractClass<T = any> = Class<T> & Function;
export const InjectedTypeSymbol = Symbol();
export const MiddlewareForSymbol = Symbol();

interface CallableThis {
  <T>(type: T): InjectedType<T>;
}

class CallableThis {
  static construct: (di: DI, args: any[]) => any;
  private apply!: any;
  /** @deprecated */
  protected arguments!: any;
  /** @deprecated */
  protected bind!: any;
  /** @deprecated */
  protected call!: any;
  /** @deprecated */
  protected caller!: any;
  /** @deprecated */
  protected length?: any;
  /** @deprecated */
  protected name?: any;
  private prototype!: any;
  /** @deprecated */
  protected toString!: any;
  private [Symbol.hasInstance]!: any;
}

export interface ContextualConstructor {
  construct: (di: DI, args: any[]) => any;
  deps?: readonly Class[];
  new (): CallableThis;
  (config: ContextualConfig): ContextualConstructor;
}

export type ContextualConfig = {
  /** For stateful services, define which other services this depends on.
   * An injected service singleton instance will be the same as long as all the
   * dependent services are the same.
   */
  deps?: Class[];

  /** Stateful.
   *
   * Configure true if the service need to store stateful properties. Combine with deps
   * in order to keep the state between different DI configurations as long as the
   * implementation of the dependent services does not change.
   *
   * If stateful is true, injected instance is created using its default constructor.
   * If stateful is falsy, injected instance is created without a constructor and ignoring
   * any declared props, unless 'construct' defines another way to create instances.
   *
   * Stateless services are more lightweight and do not need one proxy per
   * instance.
   */
  stateful?: true;

  /** Define the exact way to construct an instance
   * Can be used to define whether to use some kind of proxy in front of the instance, and
   * how to build up that proxy (or not).
   * This is a low-level configuration and can be used by library authors to support new
   * kind of services or entities.
   */
  construct?: (di: DI, args: any[]) => any;
};

export const Contextual: ContextualConstructor = function (
  config: ContextualConfig
) {
  const ContextualWithConfig =
    function () {} as unknown as ContextualConstructor;
  ContextualWithConfig.deps = config.deps && Object.freeze(config.deps);
  ContextualWithConfig.prototype = Object.create(Contextual.prototype);
  //Object.setPrototypeOf(ContextualWithConfig, Contextual); // Not really needed actually. No static props needs to be inherited.
  ContextualWithConfig.construct =
    "construct" in config
      ? config.construct
      : "stateful" in config && config.stateful
      ? function (di, args) {
          // Construct the instance so it behaves exactly as new:ed but also
          // being able to call as a function:
          // NOTE: 'this' is the Class here:
          const obj = Reflect.construct(this, args) as any;
          const redirectHandler: ProxyHandler<any> = {
            apply: (inject, thiz, args) => Reflect.apply(inject, di, args),
            get: (_, prop) => obj[prop],
            set: (_, prop, value) => Reflect.set(obj, prop, value),
          };
          for (const [prop, fn] of Object.entries(Reflect)) {
            if (!(prop in redirectHandler)) {
              redirectHandler[prop] = (_: object, ...args: any[]) =>
                Reflect[prop](obj, ...args);
            }
          }
          return new Proxy(di.inject, redirectHandler);
        }
      : Contextual.construct;
  return ContextualWithConfig;
} as unknown as ContextualConstructor;

Contextual.construct = function (di) {
  // Default stateless services
  const f = di.inject.bind(di);
  Object.setPrototypeOf(f, this.prototype);
  f.constructor = this;
  return f;
};


export type InjectedType<T> = T extends AbstractClass<infer R>
  ? R extends { [InjectedTypeSymbol]: new () => infer IT }
    ? IT
    : R
  : never;

  /** Middleware */
export type DIMiddleware = (di: DI) => DI;

/** DI provider.
 *
 * Can be either of the following:
 * * A subclass to a generic class. Will map all its super classes to given sub class. Affects both create() and inject().
 * * An instance of a concrete class. Will map all its super classes to given instance. Affects inject() but not create().
 * * A middleware. Will inject itself in front of any instance of given Class.
 */
export type DIProvider = Class<any> | object | DIMiddleware;

export interface DI {
  injectCache: WeakMap<Class, object>;
  /** Maps a generic class to a concrete implemetation class */
  map<C extends Class>(Class: C): C;

  /** Hook for middelwares to inject layers in front if any instance returned from inject() or create() */
  proxyInstance<T extends object>(i: T): T;

  /** Creates an instance of a class (like new()) */
  create<C extends Class | ContextualConstructor>(
    Class: C,
    ...args: ConstructorParameters<C>
  ): InstanceType<C>;

  run<T>(fn: (this: CallableThis) => T): T;

  /** Injects a singleton class instance and memoizes the result. Calls _inject internally. */
  inject<C extends Class | ContextualConstructor>(Class: C): InjectedType<C>;

  /** Injects a singleton class instance. */
  _inject<C extends Class | ContextualConstructor>(Class: C): InjectedType<C>;

  /** Creates a new DI environment that derives current but adds given providers */
  DI(...args: DIProvider[]): DI;
}

type InjectMap = WeakMap<object, object | InjectMap>;

type WithMiddlewareFor<T> = T & {
  [MiddlewareForSymbol]?: WithMiddlewareFor<T>;
};
function getBackingInstance<T>(i: WithMiddlewareFor<T>) {
  const backer = i[MiddlewareForSymbol];
  return backer ? getBackingInstance(backer) : i;
}

const depInjectCache: InjectMap = new WeakMap<Class, object | InjectMap>();
function findDependentInjection<C extends Class & { deps: Class[] }>(
  di: DI,
  Class: C
): [InstanceType<C>, object[]] {
  const { deps } = Class;
  let i = 0,
    l = deps.length;
  let x = depInjectCache.get(Class);
  const depInstances = deps.map((dep) => getBackingInstance(di.inject(dep)));
  while (x && x instanceof WeakMap) {
    if (i >= l) throw Error("INTERNAL: Deps inconsistency!");
    x = x.get(depInstances[i++]);
  }
  return [x as InstanceType<C>, depInstances];
}

function storeDependentInjection(
  C: Class,
  instance: object,
  depInstances: object[]
) {
  let wm1 = depInjectCache as WeakMap<object, object>;
  let key = C as object;
  for (let i = 0, l = depInstances.length; i < l; ++i) {
    let wm2 = wm1.get(key) as WeakMap<object, object>;
    if (!wm2 || !(wm2 instanceof WeakMap)) {
      wm1.set(key, (wm2 = new WeakMap()));
    }
    key = depInstances[i];
    wm1 = wm2;
  }
  wm1.set(key, instance);
}

let circProtect: WeakSet<any> | undefined | null;
const defaultDI: DI = {
  injectCache: new WeakMap<Class, object>(),

  map(Class) {
    return Class;
  },

  proxyInstance(i) {
    return i;
  },

  create(Class, ...args) {
    Class = this.map(Class);
    if ("construct" in Class)
      return this.proxyInstance(Class.construct(this, args));
    return this.proxyInstance(new Class(...args));
  },

  inject<C extends Class | ContextualConstructor>(this: DI, Class: C) {
    if (!Class) throw TypeError(`Cannot inject non-class ${Class}`);
    let instance = this.injectCache.get(Class) as InjectedType<C>;
    if (!instance) {
      instance = this._inject(Class);
      this.injectCache.set(Class, instance);
    }
    return instance;
  },

  _inject(this: DI, GivenClass: Class | ContextualConstructor) {
    const Class = GivenClass.prototype[InjectedTypeSymbol] ?? GivenClass;
    if ((Class as ContextualConstructor).deps) {
      if (circProtect.has(Class)) throw Error(`Circular deps in ${Class.name}`);
      circProtect.add(Class);
      try {
        let [instance, depInstances] = findDependentInjection(
          this,
          Class as any
        );
        if (!instance) {
          instance = this.create(Class);
          storeDependentInjection(Class, instance, depInstances);
        }
        return instance;
      } finally {
        circProtect.delete(Class);
      }
    }
    return this.create(Class);
  },

  run<T>(fn: (this: CallableThis) => T) {
    if (typeof fn !== "function" || !(fn instanceof Function))
      throw new TypeError("Argument to DI.run() must be a function.");

    if (!fn.prototype)
      throw new TypeError("Argument to DI.run() must not be arrow function.");

    return fn.apply(this.inject.bind(this));
  },

  DI(this: DI, ...providers: DIProvider[]): DI {
    return providers.reduce<DI>((di, provider) => {
      if (!provider) throw new TypeError("Given provider is falsy");
      if (provider instanceof Function) {
        // Class or function
        if (Object.getPrototypeOf(provider) !== Function.prototype) {
          // Subclass
          return {
            ...di,
            injectCache: new WeakMap(),
            map(C) {
              return di.map(
                provider.prototype instanceof C ? (provider as Class) : C
              );
            },
          } as DI;
        } else {
          // Function
          // = Middleware
          return (provider as DIMiddleware)(di);
        }
      } else if (
        typeof provider === "object" ||
        typeof provider === "function"
      ) {
        // Instance
        return {
          ...di,
          injectCache: new WeakMap(),
          _inject(this: DI, Class: Class | ContextualConstructor) {
            return provider instanceof Class
              ? this.proxyInstance(provider as object)
              : di._inject.call(this, Class);
          },
        };
      } else {
        throw new TypeError("provider is neither class, function or object");
      }
    }, this);
  },
};

export function DI(...providers: DIProvider[]): DI {
  return defaultDI.DI(...providers);
}

export function middleware<T extends object>(
  Type: Class<T>,
  createMiddleware: (next: T) => Partial<T>
) {
  return (di: DI) =>
    ({
      ...di,
      mapInstance(i: T) {
        const rv = Object.create(
          i,
          Object.getOwnPropertyDescriptors(createMiddleware(i))
        );
        rv[MiddlewareForSymbol] = i;
        return rv;
      },
    } as DI);
}
