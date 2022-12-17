export const InjectedTypeSymbol = Symbol();
export type InjectedType<T> = T extends (new () => infer R) | Function
  ? R extends { [InjectedTypeSymbol]: new () => infer IT }
    ? IT
    : R
  : never;
type Class<T = any> = new (...args: any[]) => T;
type ClassOrConstructable<T = any> = Class<T> & {
  construct?: (di: DI, args: any[]) => T;
};
type InjectFn = <C extends ClassOrConstructable>(Class: C) => InjectedType<C>;
type NewFn = <C extends ClassOrConstructable>(
  Class: C,
  ...args: ConstructorParameters<C>
) => InstanceType<C>;

export const MiddlewareForSymbol = Symbol();

interface CallableThis {
  <C extends (new () => any) | Function>(type: C): InjectedType<C>;
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
      ? function ({inject}: DI, args) {
          // Construct the instance so it behaves exactly as new:ed but also
          // being able to call as a function:
          // NOTE: 'this' is the Class here:
          const Class = this;
          const obj = new Class(...args) as any;
          const redirectHandler: ProxyHandler<any> = {
            apply: (inject, thiz, args) => inject(...args),
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
            inject,
            redirectHandler
          );
        }
      : This.construct;
  return ThisWithOptions;
} as unknown as ThisConstructor;

This.construct = function ({createInject}) {
  // Default stateless services
  const f = createInject();
  Object.setPrototypeOf(f, this.prototype);
  f.constructor = this;
  return f;
};

/** Middleware */
export type DIMiddleware = (
  next: DI
) => Partial<Pick<DI, "_map" | "_getInstance">>;

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
  _new: NewFn;

  _map<C extends ClassOrConstructable>(Class: C): C;

  /** Injects a singleton class instance. */
  _inject: InjectFn;

  createInject: () => InjectFn & {new: NewFn};

  _getInstance: (Class: Class) => InstanceType<Class> | null;

  /** Injects a singleton class instance and memoizes the result. Calls _inject internally. */
  inject: InjectFn & { new: NewFn };

  map<C extends ClassOrConstructable>(Class: C): C;

  run<T>(fn: (this: CallableThis) => T): T;

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
  inject: InjectFn,
  Class: C
): [InstanceType<C>, object[]] {
  const { deps } = Class;
  let i = 0,
    l = deps.length;
  let x = depInjectCache.get(Class);
  const depInstances = deps.map((dep) => getBackingInstance(inject(dep)));
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

function createDI({ _map, _getInstance }: Partial<DI>): DI {
  const injectCache = new WeakMap<Class | Function, object>();
  const mapCache = new WeakMap<Class, Class>();

  if (!_map) _map = (Class) => Class;
  if (!_getInstance) _getInstance = (Class) => null;

  let inject: InjectFn & { new: NewFn };
  let di: DI;

  const _new = <C extends ClassOrConstructable>(
    Class: C,
    ...args: ConstructorParameters<C>
  ) => {
    const MappedClass = map(Class);
    return MappedClass.construct
      ? MappedClass.construct(di, args)
      : new MappedClass(...args);
  };

  const _inject = <C extends ClassOrConstructable>(GivenClass: C) => {
    const Class = GivenClass.prototype[InjectedTypeSymbol] ?? GivenClass;
    const customInstance = _getInstance(Class);
    if (customInstance !== null) return customInstance;
    if ((Class as ThisConstructor).deps) {
      if (circProtect.has(Class)) throw Error(`Circular deps in ${Class.name}`);
      circProtect.add(Class);
      try {
        let [instance, depInstances] = findDependentInjection(
          inject,
          Class as any
        );
        if (!instance) {
          instance = _new(Class);
          storeDependentInjection(Class, instance, depInstances);
        }
        return instance;
      } finally {
        circProtect.delete(Class);
      }
    }
    return _new(Class) as InjectedType<C>;
  };

  // Having map inline is for optimization - allows JS engine to inline it within _inject and _new
  function map<C extends ClassOrConstructable>(Class: C): C {
    let Mapped = mapCache.get(Class);
    if (Mapped !== undefined) return Mapped as C;
    Mapped = _map(Class);
    mapCache.set(Class, Mapped);
    return Mapped as C;
  }

  const createInject = () => {
    const rv = function inject<C extends ClassOrConstructable>(Class: C) {
      let instance = injectCache.get(Class) as InjectedType<C>;
      if (instance !== undefined) return instance;
      instance = _inject(Class);
      injectCache.set(Class, instance);
      return instance;
    };
    rv.new = _new;
    return rv as InjectFn & { new: NewFn };
  };

  inject = createInject();

  di = {
    _map,
    _getInstance,

    _inject,
    _new,
    createInject,

    inject,
    map,

    run<T>(this: DI, fn: (this: CallableThis) => T) {
      if (typeof fn !== "function" || !(fn instanceof Function))
        throw new TypeError("Argument to DI.run() must be a function.");

      if (!fn.prototype)
        throw new TypeError("Argument to DI.run() must not be arrow function.");

      return fn.apply(inject);
    },

    DI(this: DI, ...providers: DIProvider[]): DI {
      return providers.reduce<DI>((prev: DI, provider) => {
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
              _map<C extends ClassOrConstructable>(Class: C): C {
                return provider === Class || provider.prototype instanceof Class
                  ? (provider as C)
                  : prev._map(Class);
              },
            });
          } else {
            // Arrow function or function (= Middleware)
            return createDI({ ...prev, ...(provider as DIMiddleware)(prev) });
          }
        } else if (
          typeof provider === "object" ||
          typeof provider === "function"
        ) {
          // Instance
          return createDI({
            ...prev,
            _getInstance(Class: ClassOrConstructable) {
              return provider instanceof Class ? provider : null;
            },
          });
        } else {
          throw new TypeError("provider is neither class, function or object");
        }
      }, this);
    },
  };
  // Always let this(DI) return the current DI:
  injectCache.set(DI, di);
  return di;
}

export const DI = function (...providers: DIProvider[]) {
  return _DI.apply(defaultDI, providers);
} as DI & DI["DI"] & (new () => DI);

const defaultDI = createDI({});
const _DI = defaultDI.DI;
Object.assign(DI, defaultDI);
