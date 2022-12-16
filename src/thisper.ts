type Class<T = any> = new (...args: any[]) => T;
type ClassOrConstructable<T = any> = Class<T> & {
  construct?: (di: DI, args: any[]) => T;
};
export const InjectedTypeSymbol = Symbol();
export const MiddlewareForSymbol = Symbol();

interface CallableThis {
  <T>(type: T): InjectedType<T>;
}

declare class CallableThis {
  protected constructor();
  protected new<C extends Class>(
    Class: C,
    ...args: ConstructorParameters<C>
  ): InstanceType<C>;
  static construct: (di: DI, args: any[]) => any;
  static deps?: readonly Class[];
  private apply: any;
  /** @deprecated */
  protected arguments: any;
  /** @deprecated */
  protected bind: any;
  /** @deprecated */
  protected call: any;
  /** @deprecated */
  protected caller: any;
  /** @deprecated */
  protected length?: any;
  /** @deprecated */
  protected name: any;
  private prototype: any;
  /** @deprecated */
  protected toString: any;
  private [Symbol.hasInstance]: any;
}

export type ThisConstructor = typeof CallableThis & {
  (options: ThisOptions): ThisConstructor;
};

export type ThisOptions = {
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

export const This: ThisConstructor = function (options: ThisOptions) {
  if (new.target) return; // Invoked with new. Do nothing.
  const ThisWithOptions = function () {} as unknown as ThisConstructor;
  ThisWithOptions.deps = options.deps && Object.freeze(options.deps);
  ThisWithOptions.prototype = Object.create(This.prototype);
  //Object.setPrototypeOf(ContextualWithConfig, Contextual); // Not really needed actually. No static props needs to be inherited.
  ThisWithOptions.construct =
    "construct" in options
      ? options.construct
      : "stateful" in options && options.stateful
      ? function (di, args) {
          // Construct the instance so it behaves exactly as new:ed but also
          // being able to call as a function:
          // NOTE: 'this' is the Class here:
          const Class = this;
          const obj = new Class(...args) as any;
          Object.defineProperty(obj, 'new', {value: di._new.bind(di, di)}); // Optimizes the prototype-based version a bit.
          const redirectHandler: ProxyHandler<any> = {
            apply: (inject, thiz, args) => Reflect.apply(inject, di, args),
            get: (target, prop, receiver) => Reflect.get(obj, prop, receiver),
            set: (target, prop, value, receiver) =>
              Reflect.set(obj, prop, value, receiver),
          };
          for (const [prop, fn] of Object.entries(Reflect)) {
            if (!(prop in redirectHandler)) {
              redirectHandler[prop] = (_: object, ...args: any[]) =>
                Reflect[prop](obj, ...args);
            }
          }
          return new Proxy(
            di.inject, // No need to bind it because apply handler binds it for us.
            redirectHandler
          );
        }
      : This.construct;
  return ThisWithOptions;
} as unknown as ThisConstructor;

This.construct = function (di) {
  // Default stateless services
  const f = di.inject.bind(di);
  Object.setPrototypeOf(f, this.prototype);
  f.constructor = this;
  Object.defineProperty(f, 'new', {value: di._new.bind(di, di)}); // Optimizes the prototype-based version a bit.
  return f;
};

export type InjectedType<T> = T extends (new () => infer R) | Function
  ? R extends { [InjectedTypeSymbol]: new () => infer IT }
    ? IT
    : R
  : never;

/** Middleware */
export type DIMiddleware = (next: DI) => Partial<Pick<DI, "_map" | "_inject">>;

/** DI provider.
 *
 * Can be either of the following:
 * * A subclass to a generic class. Will map all its super classes to given sub class. Affects both create() and inject().
 * * An instance of a concrete class. Will map all its super classes to given instance. Affects inject() but not create().
 * * A middleware. Will inject itself in front of any instance of given Class.
 */
export type DIProvider = Class<any> | object | DIMiddleware;

export interface DI {
  /** Creates an instance of a class (like new()) */
  _new<C extends ClassOrConstructable>(
    di: DI,
    Class: C,
    ...args: ConstructorParameters<C>
  ): InstanceType<C>;

  _map<C extends ClassOrConstructable>(Class: C): C;

  /** Injects a singleton class instance. */
  _inject<C extends ClassOrConstructable>(di: DI, Class: C): InjectedType<C>;

  run<T>(fn: (this: CallableThis) => T): T;

  /** Injects a singleton class instance and memoizes the result. Calls _inject internally. */
  inject<C extends ClassOrConstructable>(this: DI, Class: C): InjectedType<C>;

  map<C extends ClassOrConstructable>(this: DI, Class: C): C;

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
  di: DI, // TODO: change to inject
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

function createDI(overrides: Partial<DI>): DI {
  const injectCache = new WeakMap<Class | Function, object>();
  const mapCache = new WeakMap<Class, Class>();

  // Having map inline is for optimization - allows JS engine to inline it within _inject and _new
  function map<C extends ClassOrConstructable>(di: DI, Class: C): C {
    let Mapped = mapCache.get(Class);
    if (Mapped !== undefined) return Mapped as C;
    Mapped = di._map(Class);
    mapCache.set(Class, Mapped);
    return Mapped as C;
  }

  const rv: DI = {

    _map(Class) {
      return Class;
    },

    _inject<C extends ClassOrConstructable>(di: DI, GivenClass: C) {
      const Class = GivenClass.prototype[InjectedTypeSymbol] ?? GivenClass;
      if ((Class as ThisConstructor).deps) {
        if (circProtect.has(Class))
          throw Error(`Circular deps in ${Class.name}`);
        circProtect.add(Class);
        try {
          let [instance, depInstances] = findDependentInjection(
            di,
            Class as any
          );
          if (!instance) {
            instance = di._new(di, Class);
            storeDependentInjection(Class, instance, depInstances);
          }
          return instance;
        } finally {
          circProtect.delete(Class);
        }
      }
      return di._new(di, Class) as InjectedType<C>;
    },

    // Let only _map and _inject be overridable.
    // inject, _new and map are hard bound to closure-based WeakMaps and must
    // not be overridable.
    // run() and DI() are not meant to be overridable (see no purpose for now).
    ...overrides,

    run<T>(this: DI, fn: (this: CallableThis) => T) {
      if (typeof fn !== "function" || !(fn instanceof Function))
        throw new TypeError("Argument to DI.run() must be a function.");

      if (!fn.prototype)
        throw new TypeError("Argument to DI.run() must not be arrow function.");

      return fn.apply(this.inject.bind(this));
    },
    DI(this: DI, ...providers: DIProvider[]): DI {
      return providers.reduce<DI>((next, provider) => {
        if (provider instanceof Function) {
          // Class or function
          if (
            Object.getPrototypeOf(provider) !== Function.prototype ||
            (provider.prototype &&
              !Object.getOwnPropertyDescriptor(provider, "prototype").writable)
          ) {
            // A subclass or base class
            // When anyone wants to inject any of its superclasses,
            // give them this class!
            return createDI({
              ...next,
              _map<C extends ClassOrConstructable>(Class: C): C {
                return provider === Class || provider.prototype instanceof Class
                  ? (provider as C)
                  : next._map(Class);
              }
            });
          } else {
            // Arrow function or function (= Middleware)
            return createDI({...next, ...(provider as DIMiddleware)(next)});
          }
        } else if (
          typeof provider === "object" ||
          typeof provider === "function"
        ) {
          // Instance
          return createDI({
            ...next,
            _inject(di: DI, Class: ClassOrConstructable) {
              return provider instanceof Class
                ? provider
                : next._inject(di, Class);
            },
          });
        } else {
          throw new TypeError("provider is neither class, function or object");
        }
      }, this);
    },

    inject<C extends ClassOrConstructable>(this: DI, Class: C) {
      let instance = injectCache.get(Class) as InjectedType<C>;
      if (instance !== undefined) return instance;
      instance = this._inject(this, Class);
      injectCache.set(Class, instance);
      return instance;
    },

    _new(di, Class, ...args) {
      const MappedClass = map(di, Class);
      return MappedClass.construct
        ? MappedClass.construct(di, args)
        : new MappedClass(...args);
    },

    map(Class) {
      return map(this, Class);
    },
  };
  // Always let this(DI) return the current DI:
  injectCache.set(DI, rv);
  return rv;
}

export const DI = function (...providers: DIProvider[]) {
  return _DI.apply(defaultDI, providers);
} as DI & DI["DI"] & (new () => DI);

const defaultDI = createDI({});
const _DI = defaultDI.DI;
Object.assign(DI, defaultDI);

Object.defineProperties(This.prototype, {
  new: {
    value(Class: Class, ...args: any[]) {
      const di = this(DI);
      return di._new(di, Class, ...args);
    },
  },
});
