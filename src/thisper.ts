/*
  Concepts and nomenclature:

  1. Context - a configuration of providers deciding which implementation to use for various classes.
  2. Provider - A mapper between a generic class into a concrete class. Can also map a class to a concrete singleton instance.
                There are three possible provider types:
                  1. Subclass provider
                  2. Instance provider
                  3. Provider middleware.
  3. Service - A class that can inject other context-aware classes.
  4. To invoke - To get a singleton instance of a given class (this())
  5. To construct - To create a new intance of a certain class (this.new())
  6. Provider middleware - A function that provides a set of hooks given a previous set of provider hooks
  7. Provider hook - A function that defines how to resolve a class or instance. There are three types of hooks:
                  1. mapClass() Maps a certain class to some concrete sub class.
                  2. getInstance() Creates the singleton instance for a certain class.
                  3. createProxy() Creates a proxy for instances.
*/

export const InjectedTypeSymbol = Symbol();
export type InjectedType<T> = T extends (new () => infer R) | Function
  ? R extends { [InjectedTypeSymbol]: new () => infer IT }
    ? IT
    : R
  : never;
type _InstanceType<T> = T extends (new (...args: any[]) => infer R) | Function
  ? R
  : never;
type _ConstructorParameters<T> = T extends
  | (new (...args: infer A) => any)
  | Function
  ? A
  : never;
type Class<T = any> = new (...args: any[]) => T;
type AbstractClass<T = any> = ((new (...args: any[]) => T) | Function) & {construct?: (ctx: DIContext, args: any[])=>T};
type ClassOrConstructable<T = any> = Class<T> & {
  construct?: (ctx: DIContext, args: any[]) => T;
};
type InjectFn = <C extends AbstractClass>(Class: C) => InjectedType<C>;
type NewFn = <C extends AbstractClass>(
  Class: C,
  ...args: _ConstructorParameters<C>
) => _InstanceType<C>;

export type ProviderMiddleware = (next: ProviderHooks) => ProviderHooks;

export const IsProxyFor = Symbol();

interface CallableThis {
  <C extends (new () => any) | Function>(type: C): InjectedType<C>;
}

declare class CallableThis {
  static construct: (ctx: DIContext, args: any[]) => any;
  static deps?: readonly Class[];
  /** This class in maintained by ***thisper*** and cannot be constructed via **new**().
   * Either create a new instance of it using **this.new**(*Type*, ...args), or if it
   * represents a singleton service, inject it using **this**(*Type*) or
   * DI(...providers).inject(*Type*).
   */
  protected constructor();
  protected new<C extends AbstractClass>(
    Class: C,
    ...args: _ConstructorParameters<C>
  ): _InstanceType<C>;
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

declare class RunContext extends CallableThis {
  public new<C extends AbstractClass>(
    Class: C,
    ...args: _ConstructorParameters<C>
  ): _InstanceType<C>;
}

export type ServiceConstructor = typeof CallableThis & {
  (options: ServiceOptions): typeof CallableThis;
};

export type ServiceOptions = {
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
  construct?: (ctx: DIContext, args: any[]) => any;
};

export const Service: ServiceConstructor = function (options: ServiceOptions) {
  if (new.target) return; // Invoked with new. Do nothing.
  const ServiceWithOptions = function () {} as unknown as ServiceConstructor;
  ServiceWithOptions.deps = options.deps && Object.freeze(options.deps);
  ServiceWithOptions.prototype = Object.create(Service.prototype);
  //Object.setPrototypeOf(ContextualWithConfig, Contextual); // Not really needed actually. No static props needs to be inherited.
  ServiceWithOptions.construct =
    "construct" in options
      ? options.construct
      : "stateful" in options && options.stateful
      ? function ({ inject }: DIContext, args) {
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
          return new Proxy(inject, redirectHandler);
        }
      : Service.construct;
  return ServiceWithOptions;
} as unknown as ServiceConstructor;

Service.construct = function ({ createInject }) {
  // Default stateless services
  const f = createInject();
  Object.setPrototypeOf(f, this.prototype);
  f.constructor = this;
  return f;
};

/** DI provider.
 *
 * Can be either of the following:
 * * A subclass to a generic class. Will map all its super classes to given sub class. Affects both create() and inject().
 * * An instance of a concrete class. Will map all its super classes to given instance. Affects inject() but not create().
 * * A middleware. Will inject itself in front of any instance of given Class.
 */
export type DIProvider = Class<any> | object | ProviderMiddleware;

export interface ProviderHooks {
  /** Map a super class to a more concrete sub class.
   *
   * The function will be called when injecting singleton
   * services (by calling this(SuperClass)) and make it return an
   * instance of the mapped class instead of the super class (which is
   * the default).
   *
   * The function will also be called when constructing instances
   * (by calling this.new(SuperClass, ...args) and instanciate the mapped
   * constructor instead of SuperClass (which is the default behavior).
   *
   * A middleware should decide whether to map given class or not, for
   * example by checking for the existance of certain properties or
   * examining its inheritance chain using the *instanceof* operator
   * on its *prototype* property.
   *
   * If the middleware decides not to change any default behavior, implementor
   * should return previous hook's mapClass(Class).
   *
   * If the given class is returned, the middlware will reset to default behavior
   * and override any behavior from previous middlewares.
   *
   * @param Class Requested class
   * @returns A subclass of given Class, or given Class itself.
   */
  mapClass: <T extends object>(Class: AbstractClass<T>) => Class<T>;

  /** Map a certain class to a singleton instance that you provide.
   *
   * This function overrides the default behavior of injecting singleton
   * instances (by calling this(Class)). Instead of letting the framework
   * construct an instance of given class, the exact instance returned by this
   * function will be returned.
   *
   * The implementor of this callback may populate properties on the instance
   * or call a non-default constructor with configured values before returning
   * it.
   *
   * This function will be called before *mapClass* is called.
   *
   * @param Class Requested class
   * @returns An instance of given class
   */
  getInstance: <T extends object>(
    Class: AbstractClass<T>
  ) => T | null;

  /** Create a proxy in front of given instance.
   *
   * This function is called before returning any instance to the callers of
   * *this(Class)* or *this.new(Class, ...args)*. The implementor may
   * return a Proxy for the instance and inject custom behaviors on it.
   * A middleware could for example return a Proxy that logs any property
   * access. Middlware can decide whether to proxy all instances or just
   * certain instances based on instance type (using the *instanceof* operator).
   *
   * @param instance Instance that is about to be returned.
   * @returns An instance to return instead, such as a Proxy.
   */
  createProxy: <T extends object>(instance: T) => T;
}

export abstract class DIContext {
  abstract hooks: ProviderHooks;

  abstract createInject: () => InjectFn & { new: NewFn };

  /** Injects a singleton class instance and memoizes the result. Calls _inject internally. */
  abstract inject: InjectFn & { new: NewFn };

  abstract "new": NewFn;

  abstract map<C extends ClassOrConstructable>(Class: C): C;

  abstract run<T>(fn: (this: RunContext) => T): T;

  /** Creates a new DI environment that derives current but adds given providers */
  abstract provide(...args: DIProvider[]): DIContext;
}

function getBackingInstance<T>(i: any) {
  const backer = i[IsProxyFor];
  return backer ? getBackingInstance(backer) : i;
}

type InjectMap = WeakMap<object, object | InjectMap>;
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
  wm1.set(key, getBackingInstance(instance));
}

const circProtect = new WeakSet<any>();

function createDI(hooks: ProviderHooks): DIContext {
  const { mapClass, getInstance, createProxy } = hooks;
  const injectCache = new WeakMap<AbstractClass | Function, object>();
  const mapCache = new WeakMap<AbstractClass, Class>();

  let inject: InjectFn & { new: NewFn };
  let ctx: DIContext;

  const _new: NewFn = <C extends AbstractClass>(
    Class: C,
    ...args: _ConstructorParameters<C>
  ) => {
    const MappedClass = map(Class);
    return createProxy(MappedClass.construct
      ? MappedClass.construct(ctx, args)
      : new (MappedClass as Class)(...args));
  };

  const _inject = <C extends ClassOrConstructable>(GivenClass: C) => {
    const Class = GivenClass.prototype[InjectedTypeSymbol] ?? GivenClass;
    let instance = getInstance(Class);
    if (instance !== null) {
      instance = createProxy(instance);
      injectCache.set(Class, instance);
      return instance;
    }
    if ((Class as ServiceConstructor).deps) {
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
        injectCache.set(Class, instance);
        return instance;
      } finally {
        circProtect.delete(Class);
      }
    }
    instance = _new(Class) as InjectedType<C>;
    injectCache.set(Class, instance);
    return instance;
  };

  // Having map inline is for optimization - allows JS engine to inline it within _inject and _new
  function map<C extends AbstractClass>(Class: C): C {
    let Mapped = mapCache.get(Class);
    if (Mapped !== undefined) return Mapped as C;
    Mapped = mapClass(Class);
    mapCache.set(Class, Mapped);
    return Mapped as C;
  }

  const createInject = () => {
    const rv = function inject<C extends ClassOrConstructable>(Class: C) {
      let instance = injectCache.get(Class) as InjectedType<C>;
      if (instance !== undefined) return instance;
      return _inject(Class);
    };
    rv.new = _new;
    return rv as InjectFn & { new: NewFn };
  };

  inject = createInject();

  ctx = {
    hooks,
    createInject,
    inject,
    map,
    new: _new,
    run<T>(this: DIContext, fn: (this: RunContext) => T) {
      if (typeof fn !== "function" || !(fn instanceof Function))
        throw new TypeError("Argument to DI.run() must be a function.");

      if (!fn.prototype)
        throw new TypeError("Argument to DI.run() must not be arrow function.");

      return fn.apply(inject);
    },
    provide(this: DIContext, ...providers: DIProvider[]): DIContext {
      return providers.reduce<DIContext>(({ hooks }: DIContext, provider) => {
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
              ...hooks,
              mapClass: <T extends object>(Class: AbstractClass<T>) =>
                ((provider as any) === Class ||
                provider.prototype instanceof Class
                  ? provider
                  : hooks.mapClass(Class)) as any,
            });
          } else {
            // Arrow function or function (= Middleware)
            return createDI({ ...hooks, ...(provider as ProviderMiddleware)(hooks) });
          }
        } else if (
          typeof provider === "object" ||
          typeof provider === "function"
        ) {
          // Instance
          return createDI({
            ...hooks,
            getInstance: <T>(Class: AbstractClass<T>) =>
              provider instanceof Class ? provider as T : null,
          });
        } else {
          throw new TypeError("provider is neither class, function or object");
        }
      }, this);
    },
  };
  // Always let this(DI) return the current DI:
  injectCache.set(DIContext, ctx);
  return ctx;
}

export const DI = function (...providers: DIProvider[]) {
  return _DI.apply(defaultDIContext, providers);
} as DIContext & DIContext["provide"];

const defaultDIContext = createDI({
  createProxy: (x) => x,
  getInstance: () => null,
  mapClass: (C) => C as Class,
});
const _DI = defaultDIContext.provide;

Object.assign(DI, defaultDIContext);
